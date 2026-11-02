// XMLTV programme guides: the file that comes with an M3U playlist.
//
//   <tv>
//     <channel id="yle1.fi"><display-name>Yle TV1</display-name>
//       <icon src="http://…"/></channel>
//     <programme start="20261101200800 +0100" stop="20261101203800 +0100"
//                channel="yle1.fi">
//       <title lang="fi">Uutiset</title><desc lang="fi">…</desc>
//     </programme>
//   </tv>
//
// A guide runs to tens of megabytes (a provider's measured 24 MB, 5,449
// channels and 79,000 programmes), often gzipped, so it is read as it
// downloads rather than handed to DOMParser whole: only <channel> and
// <programme> elements matter, and they are found by their tags. What is
// read is what the format's DTD says and what providers write:
//
//  - start and stop are YYYYMMDDhhmmss with an offset, "+0100" or
//    "+01:00"; seconds, minutes and the offset may be missing, and a time
//    with no offset is UTC
//  - a title or description may come in several languages (lang="…");
//    the reader's language is taken when there, the first one otherwise
//  - the text is XML: entities, numeric references and CDATA

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** XML text to plain text. */
export function decodeXml(text) {
  if (!text) return '';
  let out = text;
  if (out.includes('<![CDATA[')) out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, data) => data.replace(/&/g, '&amp;'));
  if (!out.includes('&')) return out;
  return out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** An element's attributes. */
function attributes(tag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeXml(m[2] ?? m[3] ?? '');
  return out;
}

/**
 * An XMLTV time in milliseconds, or NaN. "20261101200800 +0100",
 * "20261101200800+01:00", "202611012008", "20261101200800 Z".
 */
export function parseXmltvTime(text) {
  const m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|Z|UTC|GMT)?/i.exec(String(text || ''));
  if (!m) return Number.NaN;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (!m[7]) return utc;
  const offset = (Number(m[8]) * 60 + Number(m[9])) * 60000;
  return m[7] === '+' ? utc - offset : utc + offset;
}

/**
 * The text of the element `name` in `body` in the preferred language, the
 * first one when none is in it, '' when there is none.
 */
const PICKERS = new Map();
function pick(body, name, languages) {
  if (!body.includes(`<${name}`)) return '';
  let re = PICKERS.get(name);
  if (!re) { re = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, 'gi'); PICKERS.set(name, re); }
  re.lastIndex = 0;
  let first = null;
  let best = null;
  let rank = Infinity;
  let m;
  while ((m = re.exec(body))) {
    const text = decodeXml((m[2] || '').trim());
    if (!text) continue;
    if (first == null) first = text;
    const lang = /\blang\s*=\s*["']([^"']*)["']/i.exec(m[1])?.[1]?.toLowerCase().slice(0, 2);
    const at = lang ? languages.indexOf(lang) : -1;
    if (at >= 0 && at < rank) { rank = at; best = text; }
  }
  return best ?? first ?? '';
}

/**
 * The guide, a piece at a time: push() each piece of text, end() at the
 * end. Channels go to onChannel({ id, names, icon }), programmes to
 * onProgramme(channelId, { title, description, start, stop }).
 */
export class XmltvParser {
  constructor({ onChannel, onProgramme, languages = [] }) {
    this.onChannel = onChannel;
    this.onProgramme = onProgramme;
    this.languages = languages.map((l) => String(l).toLowerCase().slice(0, 2));
    this.buffer = '';
    this.channels = 0;
    this.programmes = 0;
  }

  push(text) {
    this.buffer += text;
    let at = 0;
    const data = this.buffer;
    for (;;) {
      const open = data.indexOf('<', at);
      if (open < 0) { at = data.length; break; }
      const isProgramme = data.startsWith('<programme', open) && /[\s>/]/.test(data[open + 10] || '');
      const isChannel = !isProgramme && data.startsWith('<channel', open) && /[\s>/]/.test(data[open + 8] || '');
      if (!isProgramme && !isChannel) {
        // Not an element of ours: go past it. One cut off at the end of the
        // piece waits for the next, in case it is the start of one.
        if (data.length - open < 12) { at = open; break; }
        at = open + 1;
        continue;
      }
      const name = isProgramme ? 'programme' : 'channel';
      const tagEnd = data.indexOf('>', open);
      if (tagEnd < 0) { at = open; break; }
      let end;
      let body;
      if (data[tagEnd - 1] === '/') { end = tagEnd + 1; body = ''; }
      else {
        const close = data.indexOf(`</${name}>`, tagEnd);
        if (close < 0) { at = open; break; }
        end = close + name.length + 3;
        body = data.slice(tagEnd + 1, close);
      }
      const attrs = attributes(data.slice(open + name.length + 1, tagEnd));
      if (isProgramme) this.programme(attrs, body); else this.channel(attrs, body);
      at = end;
    }
    this.buffer = data.slice(at);
  }

  end() { this.buffer = ''; }

  channel(attrs, body) {
    if (!attrs.id) return;
    const names = [];
    const re = /<display-name\b[^>]*>([\s\S]*?)<\/display-name\s*>/gi;
    let m;
    while ((m = re.exec(body))) { const name = decodeXml(m[1].trim()); if (name) names.push(name); }
    const icon = /<icon\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/i.exec(body)?.[1];
    this.channels++;
    this.onChannel?.({ id: attrs.id, names, icon: icon ? decodeXml(icon) : null });
  }

  programme(attrs, body) {
    const start = parseXmltvTime(attrs.start);
    const stop = parseXmltvTime(attrs.stop);
    if (!attrs.channel || !Number.isFinite(start)) return;
    const title = pick(body, 'title', this.languages);
    const sub = pick(body, 'sub-title', this.languages);
    const desc = pick(body, 'desc', this.languages);
    this.programmes++;
    this.onProgramme?.(attrs.channel, {
      title,
      description: sub && desc ? `${sub}. ${desc}` : sub || desc,
      start,
      // A programme with no stop runs until the next one starts; the caller
      // fills that in once the channel's programmes are sorted.
      stop: Number.isFinite(stop) ? stop : Number.NaN,
    });
  }
}

/** The whole guide at once, for tests: { channels, programmes: Map(id → list) }. */
export function parseXmltv(text, languages = []) {
  const channels = [];
  const programmes = new Map();
  const parser = new XmltvParser({
    languages,
    onChannel: (c) => channels.push(c),
    onProgramme: (id, p) => { if (!programmes.has(id)) programmes.set(id, []); programmes.get(id).push(p); },
  });
  parser.push(text);
  parser.end();
  for (const [id, list] of programmes) programmes.set(id, settle(list));
  return { channels, programmes };
}

/**
 * A channel's programmes in time order, a missing stop filled from the next
 * start, and one that ends before it starts dropped.
 */
export function settle(list) {
  list.sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length; i++) {
    if (!Number.isFinite(list[i].stop)) list[i].stop = list[i + 1] ? list[i + 1].start : list[i].start + 3600e3;
  }
  return list.filter((p) => p.stop > p.start);
}

/** A channel name folded for matching a guide's channel to a playlist's: "FI: Yle TV1 HD" → "yletv1". */
export function channelMatchKey(name) {
  return String(name || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^\s*[|[(]?[a-z]{2,3}[|\])]?\s*[:|-]\s*/, '')
    .replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|backup|\d{3,4}p)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
