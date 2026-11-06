// @ts-check
// Picks for the empty player's page: what is on now and coming up on the
// viewer's own channels, in the order the viewer is likely to want it.
//
// The channels are the favourites and the ones watched lately; the
// programmes come from the guide those channels already have. What the
// viewer is interested in is learnt as they watch: a programme watched for
// a few minutes is noted by its title (noteWatched), and a reminder set for
// one counts too. Nothing leaves the browser — the notes are a personal
// list of the account's like its history (js/config.js), synced with it
// when sync is on.
//
// The order, from most to least telling:
//  - a programme the viewer has watched before (the same series by its
//    title, episode numbers and the like aside), the more often and the
//    more lately the better
//  - one they set a reminder for
//  - a favourite channel's, then a channel watched often and lately
//  - on now with time left, or starting soon, before later in the day
// At most PER_CHANNEL from one channel, so that one busy favourite does not
// fill the row.

const PER_CHANNEL = 2;
const MAX_NOTES = 200;
const DAY = 86400e3;
// A programme on now is worth starting only with this much of it left.
const MIN_LEFT_MS = 10 * 60e3;

/**
 * A programme's title as the same programme from one day to the next:
 * "Uutiset · Episode 5", "Uutiset (R)", "Uutiset S02E05", "UUTISET: osa 3"
 * are all "uutiset".
 */
export function programmeKey(title) {
  return String(title || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s*[·|–—-]\s*(episode|jakso|avsnitt|episod|folge|épisode|part|osa|del|teil)\b.*$/u, '')
    .replace(/\b(s\d{1,3}\s*e\d{1,4}|\d{1,2}x\d{1,3})\b.*$/u, '')
    .replace(/[:,]\s*(episode|jakso|avsnitt|part|osa|del|teil)\s*\d+.*$/u, '')
    .replace(/\((r|uusinta|repeat|new|uusi|live|hd)\)/gu, '')
    .replace(/\b(\d+\/\d+)\s*$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The words of a title that say something: four letters or more. */
function words(key) {
  return key.split(' ').filter((w) => w.length >= 4);
}

/**
 * The notes with one more watch of a programme. Keeps the MAX_NOTES most
 * telling — watched often, or lately — so that the list stays small enough
 * to sync.
 */
export function noteWatched(notes, title, now = Date.now()) {
  const key = programmeKey(title);
  if (!key) return notes;
  const out = { ...(notes || {}) };
  const had = out[key];
  out[key] = { t: title, n: (had?.n || 0) + 1, at: now };
  const keys = Object.keys(out);
  if (keys.length <= MAX_NOTES) return out;
  // The one just watched always stays: a new interest starts from one
  // watch, and would otherwise lose to every old one at once.
  const worth = (k) => out[k].n * 0.5 ** ((now - out[k].at) / (30 * DAY));
  const rest = keys.filter((k) => k !== key).sort((a, b) => worth(b) - worth(a));
  return Object.fromEntries([key, ...rest.slice(0, MAX_NOTES - 1)].map((k) => [k, out[k]]));
}

/**
 * The picks, best first.
 *
 * @param {object} o
 * @param {{item: object, favorite: boolean, rank: number|null}[]} o.channels
 *        rank: the channel's place among those watched lately, 0 the latest,
 *        null when it has not been watched
 * @param {(item: object) => object[]|null} o.listings a channel's programmes
 * @param {Record<string, {t:string, n:number, at:number}>} o.notes what was watched
 * @param {Set<string>} [o.reminded] the programme keys with a reminder set
 * @param {number} [o.now]
 * @param {number} [o.horizonMs] how far ahead a programme may start
 * @param {number} [o.limit] how many picks at most
 * @returns {{channel: object, programme: object, on: boolean, score: number,
 *            why: 'watched'|'reminder'|'favorite'|'often'}[]}
 */
export function pickProgrammes({ channels, listings, notes = {}, reminded = new Set(), now = Date.now(), horizonMs = 6 * 3600e3, limit = 8 }) {
  const noteWords = new Set(Object.keys(notes).flatMap(words));
  const candidates = [];
  for (const { item, favorite, rank } of channels) {
    const list = listings(item);
    if (!list || !list.length) continue;
    const channelScore = (favorite ? 3 : 0) + (rank != null ? Math.max(0.5, 2.5 - rank * 0.2) : 0);
    for (const p of list) {
      if (!p.title || p.stop <= now || p.start > now + horizonMs) continue;
      const on = p.start <= now;
      if (on && p.stop - now < MIN_LEFT_MS) continue;
      const key = programmeKey(p.title);
      if (!key) continue;
      const note = notes[key];
      let score = channelScore;
      /** @type {'watched'|'reminder'|'favorite'|'often'} */
      let why = favorite ? 'favorite' : 'often';
      if (note) {
        score += (6 + 2 * Math.log2(1 + note.n)) * 0.5 ** ((now - note.at) / (30 * DAY));
        why = 'watched';
      } else if (reminded.has(key)) {
        score += 5;
        why = 'reminder';
      } else {
        // A word shared with something watched is a hint, not a match.
        const shared = words(key).filter((w) => noteWords.has(w)).length;
        score += Math.min(2, shared);
      }
      if (on) score += 1.5;
      else if (p.start - now <= 30 * 60e3) score += 1.2;
      else if (p.start - now <= 2 * 3600e3) score += 0.6;
      candidates.push({ channel: item, programme: p, on, score, why });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.programme.start - b.programme.start);
  const perChannel = new Map();
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const id = String(c.channel.id);
    const count = perChannel.get(id) || 0;
    if (count >= PER_CHANNEL) continue;
    // A programme once: the same on two channels (an HD and an SD feed),
    // or its next airing as well, says nothing the first card does not.
    const same = programmeKey(c.programme.title);
    if (seen.has(same)) continue;
    seen.add(same);
    perChannel.set(id, count + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
