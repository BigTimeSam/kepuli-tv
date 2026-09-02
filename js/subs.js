// Tekstitysraidat MKV:stä <video>-elementille.
//
// Kontin purku (remux.js) heittää tänne ne lohkot, jotka kuuluvat
// tekstitysraidalle. Piirtämistä ei tehdä itse: lohkon teksti kaivetaan
// esiin, ajoitetaan ja annetaan selaimelle VTTCue:na. Näin tekstitys näkyy
// myös koko näytön tilassa ja Chromen omassa tekstitysvalikossa — oma
// päällyskerros katoaisi heti kun katsoja painaa videon omaa
// koko näytön painiketta.
//
// Kaikkien tekstiraitojen cuet kerätään talteen samalla kertaa, vaikka vain
// yksi on kerrallaan näkyvissä. Vaihtoehto olisi lukea tiedosto uudelleen
// raitaa vaihdettaessa, mikä maksaisi ainoan sallitun yhteyden ja
// keskeyttäisi kuvan. Teksti on kevyttä: 45 minuutin jaksossa on raitaa
// kohti muutama sata cuea.
//
// Bittikarttatekstitykset (PGS, VOBSUB) jäävät ulkopuolelle: ne ovat kuvia,
// eikä niitä voi antaa VTTCue:lle.

import { shortLanguage } from './probe.js';
import { t } from './i18n.js';

const SUBTITLE_TYPE = 17;

// Muodot joiden hyötykuorma on tekstiä. Arvo näkyy valitsimen vihjeessä.
const FORMAT = {
  'S_TEXT/UTF8': 'SRT', 'S_TEXT/ASS': 'ASS', 'S_TEXT/SSA': 'ASS', 'S_TEXT/WEBVTT': 'VTT',
};

// Lohkossa ei aina ole BlockDurationia. Kesto arvataan, ja arvaus lyhenee
// heti kun seuraava cue alkaa — pysyvä ylipitkä cue jäisi kuvaan roikkumaan.
const FALLBACK_SECONDS = 4;
const MIN_SECONDS = 0.2;

export const isTextSubtitle = (track) =>
  track.type === SUBTITLE_TYPE && Boolean(FORMAT[track.codecId]);

const DECODER = new TextDecoder();

/**
 * Raita jolle valinta osuu, tai null. Pakotettu raita kääntää vain vieraat
 * repliikit, joten se ei kelpaa kielivalinnan vastineeksi jos täysi raita on
 * tarjolla.
 *
 * @param {object[]} entries setup():n palauttama lista
 * @param {string|null} language 'fi', 'off' tai null
 */
export function preferred(entries, language) {
  if (!language || language === 'off') return null;
  const wanted = shortLanguage(language);
  const matches = entries.filter((e) => shortLanguage(e.language) === wanted);
  if (!matches.length) return null;
  const full = matches.filter((e) => !e.forced);
  const pick = full.find((e) => e.default) || full[0] || matches[0];
  return pick.number;
}

/**
 * Videoelementin tekstitysraidat. Yksi ilmentymä yhtä toistoa kohti.
 */
export class SubtitleTracks {
  /**
   * @param {HTMLVideoElement} video
   * @param {(active:number|null) => void} onChange kutsutaan myös kun katsoja
   *        vaihtaa raitaa selaimen omasta valikosta
   */
  constructor(video, onChange) {
    this.video = video;
    this.onChange = onChange || (() => {});
    this.entries = [];
    this.byNumber = new Map();
    this.active = null;
    this.listener = () => this.report();
    video.textTracks.addEventListener('change', this.listener);
  }

  /**
   * Luo raidat otsikon TrackEntryistä ja palauttaa niistä valitsimen
   * tarvitseman kuvauksen.
   *
   * @param {object[]} tracks vain tekstimuotoiset raidat
   */
  setup(tracks) {
    const claimed = new Set();
    for (const track of tracks) {
      const language = (track.langBcp || track.lang || 'und').toLowerCase();
      const text = label(track, language);
      // Avain sitoo raidan uudelleenkäytettävään TextTrackiin. Nimi ja kieli
      // ovat vain luettavia, joten sama TextTrack kelpaa vain jos molemmat
      // täsmäävät — muuten selaimen valikko näyttäisi väärän nimen.
      let key = `${language}|${text}`;
      for (let n = 2; claimed.has(key); n++) key = `${language}|${text}#${n}`;
      claimed.add(key);
      const entry = {
        number: track.number,
        codecId: track.codecId,
        format: FORMAT[track.codecId],
        language,
        label: text,
        forced: Boolean(track.forced),
        default: track.isDefault !== false,
        track: acquire(this.video, key, text, shortLanguage(language)),
        seen: new Set(),
        open: null,
      };
      entry.track.mode = 'disabled';
      this.entries.push(entry);
      this.byNumber.set(entry.number, entry);
    }
    // Sama nimi kahdesti kertoisi katsojalle vain että valintoja on kaksi.
    const counts = new Map();
    for (const entry of this.entries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    const running = new Map();
    for (const entry of this.entries) {
      if (counts.get(entry.label) < 2) continue;
      const n = (running.get(entry.label) || 0) + 1;
      running.set(entry.label, n);
      entry.label = `${entry.label} (${n})`;
    }
    // Valitsimeen aakkosjärjestyksessä: tiedoston oma järjestys on
    // mielivaltainen, ja kolmenkymmenen raidan listasta oikea kieli löytyy
    // vain jos sen paikan voi arvata. Sisäinen järjestys (this.entries) jää
    // tiedoston mukaiseksi, koska samannimisten raitojen numerointi nojaa
    // siihen. Vertailu suomen säännöillä, jotta ä ja ö päätyvät loppuun.
    return this.entries
      .map((e) => ({
        number: e.number, language: e.language, label: e.label,
        format: e.format, forced: e.forced, default: e.default,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fi'));
  }

  has(number) { return this.byNumber.has(number); }

  /**
   * Yksi tekstityslohko. Sama lohko voi tulla toistamiseen kelauksen
   * jälkeen, koska lataus jatkuu klusterin alusta — jo lisätty cue
   * tunnistetaan ja ohitetaan.
   *
   * @param {number} number raidan numero
   * @param {number} pts alku nanosekunteina
   * @param {number|null} duration kesto nanosekunteina
   * @param {Uint8Array} data lohkon hyötykuorma
   */
  push(number, pts, duration, data) {
    const entry = this.byNumber.get(number);
    if (!entry) return;
    const text = cueText(entry.codecId, data);
    if (!text) return;
    const start = pts / 1e9;
    const key = `${Math.round(start * 1000)}|${text}`;
    if (entry.seen.has(key)) return;
    entry.seen.add(key);

    // Edellinen arvattu kesto katkaistaan tähän: kaksi cuea ei saa olla
    // kuvassa yhtä aikaa, jos tiedosto ei niin sanonut.
    if (entry.open && entry.open.endTime > start && entry.open.startTime < start) {
      entry.open.endTime = start;
    }
    entry.open = null;

    const end = duration ? start + duration / 1e9 : start + FALLBACK_SECONDS;
    try {
      const cue = new VTTCue(start, Math.max(end, start + MIN_SECONDS), text);
      entry.track.addCue(cue);
      if (!duration) entry.open = cue;
    } catch (err) {
      console.warn('[iptv] tekstityscueta ei voitu lisätä', err);
    }
  }

  /** Näyttää yhden raidan ja piilottaa muut. Palauttaa valitun numeron. */
  select(number) {
    const wanted = this.byNumber.has(number) ? number : null;
    for (const entry of this.entries) {
      const mode = entry.number === wanted ? 'showing' : 'disabled';
      if (entry.track.mode !== mode) entry.track.mode = mode;
    }
    this.active = wanted;
    return wanted;
  }

  /** Selaimen valikosta tehty vaihto takaisin sovellukselle. */
  report() {
    let active = null;
    for (const entry of this.entries) if (entry.track.mode === 'showing') active = entry.number;
    if (active === this.active) return;
    this.active = active;
    this.onChange(active);
  }

  destroy() {
    this.video.textTracks.removeEventListener('change', this.listener);
    for (const entry of this.entries) clearTrack(entry.track);
    this.entries = [];
    this.byNumber.clear();
    this.active = null;
  }
}

/* ------------------------------------------------------------- raitavarasto */

// addTextTrack lisää raidan pysyvästi: elementistä ei ole rajapintaa sen
// poistamiseen, eikä src:n vaihto takuulla vie sitä mennessään. Ilman
// uudelleenkäyttöä selaimen tekstitysvalikko kasvaisi jakso jaksolta.
// Nimi ja kieli ovat vain luettavia, joten avain sisältää molemmat.
const POOL = new WeakMap();

function acquire(video, key, label, language) {
  let pool = POOL.get(video);
  if (!pool) { pool = new Map(); POOL.set(video, pool); }
  const existing = pool.get(key);
  if (existing && attached(video, existing)) {
    clearTrack(existing);
    return existing;
  }
  const track = video.addTextTrack('subtitles', label, language);
  pool.set(key, track);
  return track;
}

function attached(video, track) {
  for (const candidate of video.textTracks) if (candidate === track) return true;
  return false;
}

// cues on null kun raita on pois päältä, joten se on herätettävä poiston
// ajaksi.
function clearTrack(track) {
  try {
    if (track.mode === 'disabled') track.mode = 'hidden';
    const cues = track.cues;
    if (cues) for (let i = cues.length - 1; i >= 0; i--) track.removeCue(cues[i]);
    track.mode = 'disabled';
  } catch { /* selain ehti purkaa raidan */ }
}

/* ----------------------------------------------------------------- teksti */

/** Lohkon hyötykuorma näytettäväksi tekstiksi, tai '' jos ei mitään. */
export function cueText(codecId, data) {
  let raw;
  try { raw = DECODER.decode(data); } catch { return ''; }
  if (codecId === 'S_TEXT/ASS' || codecId === 'S_TEXT/SSA') return fromAss(raw);
  return fromSrt(raw);
}

// ASS-rivi on Matroskassa ilman "Dialogue:"-etuliitettä ja ilman aikoja:
// ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
// Tekstissä itsessään voi olla pilkkuja, joten vain kahdeksan ensimmäistä
// erotinta lasketaan.
function fromAss(raw) {
  let at = 0;
  for (let i = 0; i < 8; i++) {
    const comma = raw.indexOf(',', at);
    if (comma === -1) { at = 0; break; }
    at = comma + 1;
  }
  const body = raw.slice(at);
  // Piirtotilassa (\p1) "teksti" on vektorikomentoja, joilla tehdään
  // esimerkiksi tekstityksen tausta. Näytettynä se olisi pelkkää sotkua.
  if (/\{[^}]*\\p[1-9]/.test(body)) return '';
  const text = body
    .replace(/\{[^}]*\}/g, '')     // tyylikoodit: {\an8}, {\i1}, {\pos(…)}
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ');
  return clean(text);
}

// WebVTT:n cue-teksti tuntee vain muutaman tunnisteen. Muut jätetään pois:
// <font color="…"> jäisi selaimen jäsentimeltä huomiotta, mutta sen sisältö
// on tekstiä jonka pitää näkyä.
const KEEP_TAG = /^<\/?(i|b|u|ruby|rt)>$/i;

function fromSrt(raw) {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\{\\[^}]*\}/g, '')   // ASS-tyylikoodit eksyvät myös SRT-raidoille
    .replace(/<[^<>\n]+>/g, (tag) => (KEEP_TAG.test(tag) ? tag : ''));
  return clean(text);
}

const clean = (text) => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/* ------------------------------------------------------------------ nimet */

const NAMES = (() => {
  try { return new Intl.DisplayNames(['fi'], { type: 'language' }); } catch { return null; }
})();

function languageName(code) {
  if (!code || code === 'und') return null;
  try {
    const name = NAMES && NAMES.of(code);
    return name && name !== code ? name : null;
  } catch { return null; }
}

const MAX_NAME = 26;

/** Valitsimessa näkyvä nimi: "Suomi", "Suomi (pakotettu)", "Ruotsi · SDH". */
function label(track, language) {
  const code = shortLanguage(language);
  const name = languageName(code);
  let base = name ? name.charAt(0).toUpperCase() + name.slice(1) : code.toUpperCase();
  if (code === 'und' && !track.name) base = t('subs.unknown');
  const extras = [];
  // Raidan oma nimi kertoo usein sen mitä kieli ei: "SDH", "Full", "Songs".
  if (track.name && !sameish(track.name, base)) extras.push(shorten(track.name));
  if (track.forced) extras.push('pakotettu');
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

const sameish = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const shorten = (text) => {
  const trimmed = text.trim();
  return trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME - 1)}…` : trimmed;
};
