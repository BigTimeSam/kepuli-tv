#!/usr/bin/env node
// The GitHub Pages site: README.md rendered as docs/index.html, and each
// guide in docs/pages/<name>.md as docs/<name>/index.html, in the same style
// as the privacy policy and the terms of use, which are hand-written HTML in
// docs/privacy/ and docs/terms/. docs/sitemap.xml lists them all.
//
// A guide answers one search ("IPTV player for Firefox", "play an M3U
// playlist in the browser") with what a visitor needs to get going. Its
// front matter gives the <title>, the description (also the lead under the
// heading), the screenshot with its alt text, the store buttons in order and
// its place in the list of guides ("layout: questions" folds each heading's
// answer under it, and "open: 3" leaves the first three unfolded). A link
// that starts with "/" points within the site.
//
// Every language of the player has the site too: docs/pages/<lang>/ holds
// index.md (the README's part for users, translated), a file for each guide
// (title, description and alt in its front matter; the rest comes from the
// English one) and site.json (the words of the page around them, the keys
// of EN below). They become docs/<lang>/…, each page naming its other
// languages for the search engines (hreflang) and in the bar's menu. A
// language's directory must be complete and shaped as the English is.
// docs/pages/translations.json records which English text each translation
// was made from.
//
// The converter covers what the README uses — headings, paragraphs, lists,
// tables, fenced code, inline code, bold, italics and links — and nothing
// a notice ("> [!IMPORTANT]", as GitHub writes one), and nothing
// more. A construct it does not know is reported on stderr rather than
// mangled quietly. No dependencies: Node 22+ is enough.
//
//   node dev/site.mjs               writes the pages, site.css, site.js and the sitemap
//   node dev/site.mjs --check       exits 1 if any of them is out of date
//   node dev/site.mjs --try <lang>  checks one language's translation and writes nothing
//   node dev/site.mjs --stale       lists the translations made from an older English text
//   node dev/site.mjs --mark <lang…|all>   records those languages as translated from the present text

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLanguage, setLanguage, t } from '../js/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'README.md');
const DOCS = join(ROOT, 'docs');
const PAGES = join(DOCS, 'pages');
const REPO = 'https://github.com/BigTimeSam/kepuli-tv';

let warnings = 0;
let source = 'README.md';
const warn = (line, msg) => { warnings++; console.error(`${source}${line ? `:${line}` : ''}: ${msg}`); };

/* ----------------------------------------------------------------- inline */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A link that leaves the site opens in a tab of its own, so the page being
 *  read stays where it was; noopener keeps that tab from reaching this one. */
const out = (h) => (/^https?:/i.test(h) && !h.startsWith('https://bigtimesam.github.io/kepuli-tv/') ? ' target="_blank" rel="noopener"' : '');

// The way from the page being rendered to the site's root (empty for the
// English front page, "../" for an English guide, "../../" for a guide in
// another language), and that language's directory under the root ("fi/";
// empty for English).
let base = '';
let langDir = '';

/** A page of the site in the language being rendered. The policy pages are
 *  legal text and exist in English alone. */
const local = (path) => (/^(privacy|terms)\//.test(path) ? base + path : base + langDir + path) || './';

/** A link starting with "/" stays within the site; any other relative one
 *  points into the repository on GitHub, as docs/ holds no copy of it. */
const href = (h) => (h.startsWith('/') ? local(h.slice(1))
  : /^([a-z][a-z0-9+.-]*:|#)/i.test(h) ? h : `${REPO}/blob/main/${h}`);

// Code spans are lifted out before the other inline rules run, so that
// nothing inside them is touched, and put back last so that bold or a link
// may still wrap one. The placeholder is a NUL-delimited index.
const NUL = String.fromCharCode(0);
const PLACEHOLDER = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `${NUL}${codes.length - 1}${NUL}`;
  });
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${href(h)}"${out(href(h))}>${t}</a>`)
    .replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?!\s)([\s\S]+?)(?<!\s)\*(?![\w*])/g, '$1<em>$2</em>');
  return s.replace(PLACEHOLDER, (_, i) => codes[i]);
}

/** Heading text without markup, for ids, the table of contents and <title>. */
const plain = (t) => t.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*/g, '');

/* ----------------------------------------------------------------- blocks */

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}```/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const NOTICE = /^>\s*\[!(NOTE|IMPORTANT|WARNING)\]\s*$/;
const UNSUPPORTED = /^(>|!\[|<[a-zA-Z!/]|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|\s{4,}\S)/;

/** Splits a table row into cells; a pipe inside a code span does not split. */
function cells(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = []; let cur = ''; let code = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parse(md) {
  const lines = md.split('\n');
  const blank = (l) => l === undefined || /^\s*$/.test(l);
  const tableAt = (i) => /^\s*\|/.test(lines[i] ?? '') && TABLE_SEP.test(lines[i + 1] ?? '');
  const startsBlock = (i) => HEADING.test(lines[i]) || FENCE.test(lines[i]) || tableAt(i) || ITEM.test(lines[i]);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    if (FENCE.test(line)) {
      const open = i++; const body = [];
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      if (i >= lines.length) warn(open + 1, 'code fence is never closed');
      i++;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    let m;
    if ((m = HEADING.exec(line))) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2] });
      i++;
      continue;
    }

    if (tableAt(i)) {
      const header = cells(lines[i]); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if ((m = ITEM.exec(line))) {
      const indent = m[1].length;
      const ordered = m[3] !== undefined;
      const start = ordered ? Number(m[3]) : 1;
      const items = [];
      while (i < lines.length) {
        const im = ITEM.exec(lines[i]);
        if (!im || im[1].length !== indent) {
          // A blank line between items keeps the list together; anything else ends it.
          if (blank(lines[i]) && ITEM.exec(lines[i + 1] ?? '')?.[1].length === indent) { i++; continue; }
          break;
        }
        const item = [im[4]]; i++;
        while (i < lines.length && /^\s+\S/.test(lines[i])) {
          if (ITEM.test(lines[i])) warn(i + 1, 'nested list is not supported; rendered as text');
          item.push(lines[i++].trim());
        }
        items.push(item.join('\n'));
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    // A notice, written as GitHub writes one ("> [!IMPORTANT]" and the
    // text on the quoted lines after it), so that it stands in a box of
    // its own there and here. Any other quotation is still unsupported.
    if ((m = NOTICE.exec(line))) {
      const body = []; i++;
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'note', kind: m[1].toLowerCase(), text: body.join('\n') });
      continue;
    }

    if (UNSUPPORTED.test(line)) warn(i + 1, `unsupported construct, rendered as a paragraph: ${line.trim().slice(0, 40)}`);
    const para = [line]; i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(i)) para.push(lines[i++]);
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

/* ----------------------------------------------------------------- render */

// A notice's mark, drawn as the player's marks are: an i in a circle for
// what a reader should know, a triangle for what could cost them something.
const MARK_INFO = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="M10 9.2v4.6"/><circle cx="10" cy="6.3" r=".9" fill="currentColor" stroke="none"/></svg>';
const MARK_WARNING = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2 2.6 16.2h14.8z"/><path d="M10 8.2v3.6"/><circle cx="10" cy="14" r=".9" fill="currentColor" stroke="none"/></svg>';

function render(blocks, { contents = true } = {}) {
  const seen = new Map();
  const slug = (text) => {
    const base = plain(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  let title = 'Kepuli-TV';
  let description = '';
  const toc = [];
  const body = [];
  const counts = { heading: 0, p: 0, list: 0, table: 0, code: 0, note: 0 };

  for (const b of blocks) {
    counts[b.type]++;
    switch (b.type) {
      case 'heading': {
        if (b.level === 1 && body.length === 0) { title = plain(b.text); break; }
        const id = slug(b.text);
        if (b.level === 2) toc.push({ id, text: inline(b.text) });
        body.push({ tag: `h${b.level}`, html: `<h${b.level} id="${id}">${inline(b.text)}</h${b.level}>` });
        break;
      }
      case 'p':
        if (!description) description = plain(b.text).replace(/\s+/g, ' ');
        body.push({ html: `<p>${inline(b.text)}</p>` });
        break;
      case 'note':
        body.push({ html: `<aside class="note ${b.kind}">${b.kind === 'warning' ? MARK_WARNING : MARK_INFO}<p>${inline(b.text)}</p></aside>` });
        break;
      case 'code':
        body.push({ html: `<pre><code>${esc(b.text)}</code></pre>` });
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        body.push({ html: `<${tag}${start}>\n${b.items.map((t) => `  <li>${inline(t)}</li>`).join('\n')}\n</${tag}>` });
        break;
      }
      case 'table': {
        const th = b.header.map((c) => `<th>${inline(c)}</th>`).join('');
        const rows = b.rows.map((r) => {
          const cs = [...r]; while (cs.length < b.header.length) cs.push('');
          return `    <tr>${cs.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
        });
        body.push({ html: `<div class="table-scroll">\n<table>\n  <thead><tr>${th}</tr></thead>\n  <tbody>\n${rows.join('\n')}\n  </tbody>\n</table>\n</div>` });
        break;
      }
    }
  }

  // The table of contents sits above the first section, i.e. below the intro.
  const main = [];
  let tocDone = !contents || toc.length < 3;
  for (const part of body) {
    if (!tocDone && part.tag === 'h2') {
      main.push(`<nav class="toc" aria-label="${attr(S.contents)}">\n<ul>\n${toc.map((t) => `  <li><a href="#${t.id}">${t.text}</a></li>`).join('\n')}\n</ul>\n</nav>`);
      tocDone = true;
    }
    main.push(part.html);
  }
  return { title, description, main: main.join('\n\n'), counts };
}

/* ------------------------------------------------------------- the site */

// The video is a picture linking to YouTube rather than an embedded player,
// so the page loads nothing from Google until a visitor asks for it. The
// screenshots are copied from brand/screenshots/ into docs/img/ (Pages
// serves docs/ alone); their captions are the AMO set's.
const SITE = 'https://bigtimesam.github.io/kepuli-tv/';
const VIDEO = 'https://youtu.be/Wr4FcXlTbOM';
const STORES = {
  chrome: 'https://chromewebstore.google.com/detail/kepuli-tv/okkgclcakhjhldkdcblgagoaibghpfmi',
  firefox: 'https://addons.mozilla.org/firefox/addon/kepuli-tv/',
};

// The languages, in the order and by the names of the player's own menu
// (LANGUAGES in js/i18n.js), with the tag a search engine knows each by.
const LANGUAGES = {
  en: 'English', fi: 'Suomi', sv: 'Svenska', nb: 'Norsk bokmål', da: 'Dansk', de: 'Deutsch',
  nl: 'Nederlands', fr: 'Français', es: 'Español', pt: 'Português (Brasil)', it: 'Italiano',
  pl: 'Polski', tr: 'Türkçe', cs: 'Čeština', hu: 'Magyar', ro: 'Română', hr: 'Hrvatski', sq: 'Shqip',
  el: 'Ελληνικά', ru: 'Русский', uk: 'Українська', bg: 'Български', sk: 'Slovenčina', sl: 'Slovenščina',
  sr: 'Srpski', lt: 'Lietuvių', lv: 'Latviešu', et: 'Eesti', id: 'Bahasa Indonesia', vi: 'Tiếng Việt',
};
const tag = (code) => (code === 'pt' ? 'pt-BR' : code);

/** The languages in the alphabetical order of their own names, as the menu
 *  lists them: a visitor looks for "Suomi" under S, wherever the player's
 *  menu has it. Latin names come first, then Greek and Cyrillic. */
const byName = (codes) => [...codes].sort((a, b) => LANGUAGES[a].localeCompare(LANGUAGES[b], 'en'));
// The language menu's filter field says what the player's drop-downs say
// (js/picker.js), in the player's own words for each language.
const PICKER = {};
for (const code of Object.keys(LANGUAGES)) {
  await loadLanguage(code);
  setLanguage(code);
  PICKER[code] = { filter: t('picker.filter'), none: t('picker.none') };
}

// The words of the page around the texts, in English. Another language's
// site.json has the same keys. {version}, {n} and {total} are filled in.
const EN = {
  frontTitle: 'Kepuli-TV – IPTV Player for Chrome and Firefox, free and open source',
  meta: 'The README of the Kepuli-TV browser extension, version {version}.',
  source: 'Source on GitHub',
  lead: 'Your own IPTV subscription, played in a browser tab: live TV with a programme guide, films and series, recording, in thirty languages. Free and open source.',
  addChrome: 'Add to Chrome',
  addFirefox: 'Add to Firefox',
  noteAndroid: 'On Android, Kepuli-TV installs in Firefox:',
  noteIos: 'On an iPhone, Kepuli-TV installs in the Orion browser:',
  howTo: 'how to set it up',
  videoAlt: 'Kepuli-TV playing a live channel beside the channel list',
  tour: 'Watch the four-minute tour',
  videoNote: 'Opens on YouTube. Everything shown is fictional demo content.',
  captions: [
    'Browse channels by country and topic while watching live TV. Two channels side by side.',
    'Explore the programme guide while playback continues in the mini-player.',
    'Browse series details, seasons and episodes.',
    'Play an MKV episode with text subtitles and choose their language and size.',
    'Watch a movie with its description and details beside your catalogue, shown as covers.',
  ],
  screenshots: 'Screenshots',
  screenshot: 'Screenshot',
  previous: 'Previous picture',
  next: 'Next picture',
  pictureOf: 'Picture {n} of {total}',
  close: 'Close',
  demo: 'Everything shown is fictional demo content.',
  home: 'Home',
  guides: 'Guides',
  questions: 'Questions',
  contents: 'Contents',
  language: 'Language',
  menu: 'Menu',
  getTitle: 'Get Kepuli-TV',
  getText: 'Free and open source. It comes with no channels: bring your own subscription, and use it only for content you have the right to watch.',
  licence: 'MIT licence',
  privacy: 'Privacy Policy',
  terms: 'Terms of Use',
  inEnglish: '',
  affiliation: 'Kepuli-TV is a player only and is not affiliated with any IPTV provider, Google, Mozilla or Kagi.',
};
let S = EN;
let lang = 'en';
const ICONS = ['icon32.png', 'icon48.png', 'icon128.png'];
const SHOTS = ['01-channels', '02-guide', '03-series', '04-subtitles', '05-movie'];

const attr = (s) => esc(s).replace(/"/g, '&quot;');

function copyShots() {
  const dir = join(DOCS, 'img');
  mkdirSync(dir, { recursive: true });
  for (const shot of SHOTS) copyFileSync(join(ROOT, 'brand', 'screenshots', `${shot}.png`), join(dir, `${shot}.png`));
  // The extension's own icon, as the player's top bar and its tab show it.
  for (const icon of ICONS) copyFileSync(join(ROOT, 'icons', icon), join(dir, icon));
}

// The store buttons, the first one the prominent one. Both stores count the
// visits a link's utm parameters name (the Chrome dashboard and AMO's
// statistics), which tells which page brings installs without a script or a
// cookie on this site. With both stores on offer, a visitor on a phone is
// told which browser installs it there: Chrome's button is of no use to them.
function stores(campaign, which = ['chrome', 'firefox']) {
  const link = (s) => `${STORES[s]}?utm_source=github-pages&amp;utm_medium=site&amp;utm_campaign=${campaign}`;
  const notes = which.length < 2 ? '' : `
<p class="phone-note android">${esc(S.noteAndroid)} <a href="${local('iptv-player-android/')}">${esc(S.howTo)}</a>.</p>
<p class="phone-note ios">${esc(S.noteIos)} <a href="${local('iptv-player-iphone/')}">${esc(S.howTo)}</a>.</p>`;
  return `<p class="stores">
${which.map((s, n) => `  <a${n ? ' class="alt"' : ''} data-store="${s}" href="${link(s)}" target="_blank" rel="noopener">${esc(s === 'chrome' ? S.addChrome : S.addFirefox)}</a>`).join('\n')}
</p>${notes}`;
}

// A guide's illustration, docs/img/guides/<name>.webp (brand/guides/ holds
// the masters and how they were made). Decoration: the card's heading says
// what the picture shows, so its alt text is empty.
const art = (g) => (existsSync(join(DOCS, 'img', 'guides', `${g.name}.webp`))
  ? `<img src="${base}img/guides/${g.name}.webp" width="720" height="480" loading="lazy" alt="">` : '');

/** The guides as a list of links, each with its picture: on the front page
 *  with what each is about, under a guide by their names alone, as the
 *  reader is on the way out. */
function guideList(guides, current) {
  return `<nav class="guides" aria-labelledby="guides">
<h2 id="guides">${esc(S.guides)}</h2>
<ul>
${guides.map((g) => `  <li><a href="${local(`${g.name}/`)}"${g === current ? ' aria-current="page"' : ''}>${art(g)}<strong>${esc(g.heading)}</strong>${current ? '' : `<span>${esc(g.description)}</span>`}</a></li>`).join('\n')}
</ul>
</nav>`;
}

const closing = (campaign, which) => `<section class="cta" aria-labelledby="get">
<h2 id="get">${esc(S.getTitle)}</h2>
<p>${esc(S.getText)}</p>
${stores(campaign, which)}
</section>`;

function hero() {
  return `<section class="hero" aria-label="${attr(S.getTitle)}">
<p class="lead">${esc(S.lead)}</p>
${stores('home')}
<a class="video" href="${VIDEO}" target="_blank" rel="noopener">
  <img src="${base}img/01-channels.png" width="1280" height="800" alt="${attr(S.videoAlt)}">
  <span class="play"><span>▶ ${esc(S.tour)}</span></span>
</a>
<p class="video-note">${esc(S.videoNote)}</p>
<div class="side-scroll">
<button type="button" class="side-scroll-arrow prev" aria-label="${attr(S.previous)}" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4-6 6 6 6"/></svg></button>
<div class="shots" tabindex="0" aria-label="${attr(S.screenshots)}">
${SHOTS.map((shot, n) => `  <figure><a href="${base}img/${shot}.png"><img src="${base}img/${shot}.png" width="1280" height="800" loading="lazy" alt="${attr(S.captions[n])}"></a><figcaption>${esc(S.captions[n])}</figcaption></figure>`).join('\n')}
</div>
<button type="button" class="side-scroll-arrow next" aria-label="${attr(S.next)}" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6"/></svg></button>
<div class="dots" hidden>
${SHOTS.map((_, n) => `  <button type="button" aria-label="${attr(S.pictureOf.replace('{n}', n + 1).replace('{total}', SHOTS.length))}"></button>`).join('\n')}
</div>
</div>
</section>`;
}

/** What a search engine may say of the extension: only what the manifests,
 *  the licence and the stores state. No ratings or user counts. */
const software = (description, version) => JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Kepuli-TV',
  alternateName: 'Kepuli-TV – IPTV Player',
  description,
  url: SITE + langDir,
  inLanguage: tag(lang),
  applicationCategory: 'MultimediaApplication',
  applicationSubCategory: 'Browser extension',
  operatingSystem: 'Chrome 116 or newer, Firefox 130 or newer, Firefox for Android 142 or newer, Orion on iOS',
  softwareVersion: version,
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  license: 'https://opensource.org/license/mit',
  installUrl: [STORES.chrome, STORES.firefox],
  screenshot: SHOTS.map((s) => `${SITE}img/${s}.png`),
  author: { '@type': 'Person', name: 'Samuli Vainio' },
  sameAs: [REPO, STORES.chrome, STORES.firefox, VIDEO],
}, null, 1).replace(/</g, '\\u003c');

// Before the first paint, so the buttons do not swap in sight. The same
// script sends a visitor who arrives at an English page to that page in
// the first language of their browser's list that the site is in, unless
// English comes before it in the list or they have chosen a language from
// the menu before (the choice is kept in this browser, see siteNav). A
// page in another language stays as it was asked for.
const BROWSER = `(function(){var u=navigator.userAgent,h=document.documentElement,c=h.classList;if(/Android/.test(u))c.add('on-android','prefers-firefox');else if(/iPhone|iPad|iPod/.test(u))c.add('on-ios','prefers-firefox');else if(/Firefox\\//.test(u))c.add('prefers-firefox');try{if(h.lang==='en'&&!localStorage.getItem('kepuli-lang')){var want=navigator.languages||[navigator.language||''];for(var i=0;i<want.length;i++){var two=want[i].toLowerCase().slice(0,2);if(two==='en')break;if(two==='no'||two==='nn')two='nb';if(document.querySelector('link[rel="alternate"][hreflang="'+(two==='pt'?'pt-BR':two)+'"]')){location.replace(h.getAttribute('data-root')+two+'/'+h.getAttribute('data-path')+location.search+location.hash);break;}}}}catch(e){}})();`;

// The bar at the top of every page, the policy pages included, built as the
// player's own top bar is (css/topbar.css): the television and the name on
// the left, a strip of tabs with the page being read filled in the accent
// colour, and quiet buttons at the right end. A visitor who has seen one
// knows the other. The guides are one press away in a menu that needs no
// script (<details>). The bar stays in sight while a page scrolls; on a
// phone it folds behind a menu button. The policy pages
// are written by hand, so the bar and its style are stamped into them
// between "site:nav" markers.
const NAV_STYLE = `  .site {
    position: sticky; top: 0; z-index: 10;
    background: var(--panel); border-bottom: 1px solid var(--border);
    font-size: 14px; line-height: 1.4;
    --hover: color-mix(in srgb, var(--text) 8%, transparent);
  }
  /* The bar's contents keep to the column of the page under them. */
  .site-bar {
    max-width: 760px; margin: 0 auto; min-height: 52px; padding: 6px 22px;
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px;
  }
  html { scroll-padding-top: 68px; }

  .brand {
    display: flex; align-items: center; gap: 8px; padding: 5px 11px; margin: -5px -11px; border-radius: 6px;
    font-weight: 650; letter-spacing: -0.01em; white-space: nowrap;
    color: var(--text); text-decoration: none;
  }
  .brand:hover { background: var(--hover); }
  .brand-mark { width: 18px; height: 18px; flex: none; }

  .tabs { display: flex; gap: 2px; background: var(--panel-2); padding: 3px; border-radius: 9px; }
  .tabs a, .tabs summary {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 6px;
    color: var(--muted); text-decoration: none; white-space: nowrap; cursor: pointer;
  }
  .tabs svg, .site-end svg { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .tabs a:hover, .tabs summary:hover, .tabs details[open] > summary { color: var(--text); }
  .tabs [aria-current], .tabs details.current > summary, .tabs details.current[open] > summary { background: #6d4ff0; color: #fff; }
  .tabs details { position: relative; }
  .tabs summary { list-style: none; }
  .tabs summary::-webkit-details-marker { display: none; }
  /* Drawn, not a "▾" character: the system font's was a dot at this size. */
  .tabs summary::after { content: ""; flex: none; width: 6px; height: 6px; margin: -3px 2px 0 1px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg); opacity: .8; }
  .tabs ul {
    position: absolute; top: calc(100% + 9px); left: -3px; min-width: 250px;
    list-style: none; margin: 0; padding: 6px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
  }
  .tabs li { margin: 0; }
  .tabs ul a { display: block; }
  .tabs ul a:hover { background: var(--hover); }
  .tabs ul [aria-current] { background: var(--panel-2); color: var(--text); }

  .site-end { margin-left: auto; display: flex; align-items: center; gap: 2px; }
  .site-end a, .site-end summary { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 6px; color: var(--muted); text-decoration: none; white-space: nowrap; cursor: pointer; }
  .site-end a:hover, .site-end summary:hover, .site-end details[open] > summary { color: var(--text); background: var(--hover); }
  /* The languages: the player's own drop-down (js/picker.js and
     css/pickers.css) from the bar's right end: a field that narrows the
     thirty names by what is typed, over a list that scrolls. The field is
     the script's; without it the list alone opens. */
  .lang { position: relative; }
  .lang summary { list-style: none; }
  .lang summary::-webkit-details-marker { display: none; }
  /* Drawn, not a "▾" character: the system font's was a dot at this size. */
  .lang summary::after { content: ""; flex: none; width: 6px; height: 6px; margin: -3px 2px 0 1px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg); opacity: .8; }
  .lang-pop {
    position: absolute; top: calc(100% + 12px); right: 0; z-index: 2; width: 230px; max-width: calc(100vw - 28px); max-height: min(360px, calc(100vh - 90px));
    display: flex; flex-direction: column; gap: 4px; padding: 4px; overflow: hidden;
    background: var(--panel); border: 1px solid var(--border); border-radius: 9px;
    box-shadow: 0 14px 34px rgba(0, 0, 0, .45); font-size: 13px;
  }
  .lang-field { position: relative; display: flex; flex: none; }
  .lang-field[hidden], .lang li[hidden], .lang-none[hidden] { display: none; }
  .lang-field svg { position: absolute; left: 10px; top: 50%; translate: 0 -50%; width: 14px; height: 14px; stroke: var(--muted); stroke-width: 1.8; pointer-events: none; }
  .lang-field input {
    width: 100%; margin: 0; padding: 6px 8px 6px 30px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel-2); color: var(--text); font: inherit; outline: none; appearance: none;
  }
  .lang-field input:focus { border-color: var(--link); }
  .lang ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; }
  .lang li { margin: 0; }
  .lang ul a { display: block; padding: 6px 9px; border-radius: 5px; overflow: hidden; text-overflow: ellipsis; }
  .lang ul a.active { background: var(--hover); color: var(--text); }
  .lang ul a[aria-current], .lang ul a[aria-current]:hover { color: var(--link); font-weight: 600; }
  .lang-none { margin: 0; padding: 8px 9px; color: var(--muted); }
  .site a:focus-visible, .site summary:focus-visible { outline: 2px solid var(--link); outline-offset: 0; }

  /* On a phone the bar is the television, the name and, at its right end,
     the three lines of the player's own menu button: a press opens the
     tabs, the guides, the languages and GitHub as rows under the bar, and
     turns the lines into a cross. Only where the script has run (nav-js):
     without it the links stay in sight, wrapped onto rows of their own. */
  .site-menu { display: none; }
  @media (max-width: 640px) {
    .nav-js .site-menu {
      display: inline-flex; align-items: center; justify-content: center; margin-left: auto; width: 36px; height: 34px; padding: 0;
      border: 1px solid var(--border); border-radius: 8px; background: none; color: var(--muted); cursor: pointer;
    }
    .nav-js .site-menu:hover { color: var(--text); background: var(--hover); }
    .nav-js .site-menu:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
    .site-menu svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
    .site-menu .shut, .site.open .site-menu .lines { display: none; }
    .site.open .site-menu .shut { display: block; }
    /* The first row is as tall open as shut: the bar's rows are laid from
       the top, and the name and the button have the height the bar gives
       them on one row, so nothing moves when the menu opens under them. */
    .nav-js .site-bar { max-height: 100vh; overflow-y: auto; align-content: flex-start; row-gap: 0; }
    .nav-js .brand, .nav-js .site-menu { margin-top: 3px; margin-bottom: 3px; }
    .nav-js .brand { min-height: 34px; }
    .nav-js .tabs, .nav-js .site-end { display: none; }
    .nav-js .site.open .tabs, .nav-js .site.open .site-end { display: flex; flex-direction: column; align-items: stretch; flex: 0 0 100%; gap: 2px; margin: 0; padding: 0; background: none; border-radius: 0; }
    .nav-js .site.open .tabs { margin-top: 6px; padding: 8px 0 6px; border-top: 1px solid var(--border); }
    .nav-js .site.open .site-end { padding: 6px 0 10px; border-top: 1px solid var(--border); }
    .nav-js .site.open { box-shadow: 0 18px 40px rgba(0, 0, 0, .45); }
    .nav-js .site.open :is(.tabs, .site-end) :is(a, summary) { display: flex; padding: 10px 12px; border-radius: 8px; font-size: 15px; }
    .nav-js .site.open :is(.tabs, .site-end) summary::after { margin-left: auto; }
    .nav-js .site.open :is(.tabs ul, .lang-pop) { position: static; max-height: none; overflow: visible; width: auto; min-width: 0; max-width: none; margin: 0 0 6px 12px; padding: 0 0 0 10px; border: 0; border-left: 1px solid var(--border); border-radius: 0; box-shadow: none; background: none; }
    .nav-js .site.open .lang ul { display: grid; grid-template-columns: repeat(2, 1fr); overflow: visible; }
    .nav-js .site.open .lang-field { margin: 4px 0 6px; font-size: 16px; }
    .nav-js .site.open :is(.tabs, .lang) ul a { padding: 8px 12px; font-size: 14.5px; }
  }

  /* Links read as the player's do ("The full user guide" in its Help): the
     accent as ink, underlined only under the pointer, and one that leaves
     the site followed by the player's own arrow out of a box. The store
     buttons and the video picture name where they go themselves. */
  :root { --link: #a48cff; --out: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M11 3h6v6M17 3l-8 8M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4'/%3E%3C/svg%3E"); }
  @media (prefers-color-scheme: light) { :root { --link: #5537d6; } }
  .site a:hover, .stores a:hover, .guides a:hover, .video:hover, .shots a:hover, .shot a:hover { text-decoration: none; }
  a[href^="http"]:not([href^="https://bigtimesam.github.io/kepuli-tv/"]):not([data-store]):not(.video)::after {
    content: ""; display: inline-block; width: 12px; height: 12px; margin-left: 5px; vertical-align: -1px;
    background: currentColor;
    -webkit-mask: var(--out) center / contain no-repeat; mask: var(--out) center / contain no-repeat;
  }

  @media print { .site { display: none; } a::after { display: none !important; } }`;

// The marks are the player's own: the television of its Channels tab, the
// three lines of its menu, the question mark of its Help.
const MARK = {
  home: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="15" height="10.5" rx="1.8"/><path d="M7 2.5 10 5l3-2.5M6.5 18h7"/></svg>',
  guides: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>',
  faq: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="M7.9 7.8a2.2 2.2 0 1 1 3 2.1c-.6.3-.9.8-.9 1.4v.4"/><circle cx="10" cy="14.4" r=".9" fill="currentColor" stroke="none"/></svg>',
};

const GLOBE = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2.4 2.3 2.4 12.1 0 14.4M10 2.8c-2.4 2.3-2.4 12.1 0 14.4"/></svg>';

/** @param current the page's path within its language: '' the front page,
 *         'faq/', 'privacy/'…
 *  @param languages the languages the site is in. The menu at the bar's
 *         right end leads to the same page in each; from a policy page,
 *         which is in English alone, to that language's front page. */
function siteNav(guides, current, languages) {
  const here = (path) => (path === current ? ' aria-current="page"' : '');
  const listed = guides.filter((g) => g.name !== 'faq');
  const inGuides = listed.some((g) => `${g.name}/` === current);
  const same = /^(privacy|terms)\//.test(current) ? '' : current;
  const other = (code) => `${base}${code === 'en' ? '' : `${code}/`}${same}` || './';
  return `<header class="site">
<div class="site-bar">
  <a class="brand" href="${local('')}"><img class="brand-mark" src="${base}img/icon48.png" width="18" height="18" alt="">Kepuli-TV</a>
  <button type="button" class="site-menu" aria-label="${attr(S.menu)}" aria-expanded="false"><svg class="lines" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg><svg class="shut" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button>
  <nav class="tabs" aria-label="Kepuli-TV">
    <a href="${local('')}"${here('')}>${MARK.home}${esc(S.home)}</a>
    <details${inGuides ? ' class="current"' : ''}>
      <summary>${MARK.guides}${esc(S.guides)}</summary>
      <ul>
${listed.map((g) => `        <li><a href="${local(`${g.name}/`)}"${here(`${g.name}/`)}>${esc(g.heading)}</a></li>`).join('\n')}
      </ul>
    </details>
    <a href="${local('faq/')}"${here('faq/')}>${MARK.faq}${esc(S.questions)}</a>
  </nav>
  <div class="site-end">
    <details class="lang">
      <summary aria-label="${attr(S.language)}" title="${attr(S.language)}">${GLOBE}${esc(LANGUAGES[lang])}</summary>
      <div class="lang-pop">
      <span class="lang-field" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="M13.5 13.5 18 18"/></svg><input type="search" placeholder="${attr(PICKER[lang].filter)}" aria-label="${attr(PICKER[lang].filter)}" autocomplete="off" spellcheck="false"></span>
      <ul>
${byName(languages).map((code) => `        <li><a href="${other(code)}" lang="${tag(code)}" hreflang="${tag(code)}"${code === lang ? ' aria-current="true"' : ''}>${esc(LANGUAGES[code])}</a></li>`).join('\n')}
      </ul>
      <p class="lang-none" hidden>${esc(PICKER[lang].none)}</p>
      </div>
    </details>
    <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
  </div>
</div>
</header>
<script>(function(){var bar=document.querySelector('.site'),menu=bar.querySelector('.site-menu');document.documentElement.classList.add('nav-js');bar.querySelectorAll('.lang a').forEach(function(a){a.addEventListener('click',function(){try{localStorage.setItem('kepuli-lang',a.lang);}catch(e){}});});bar.querySelectorAll('.lang').forEach(function(d){var input=d.querySelector('input'),none=d.querySelector('.lang-none'),links=[].slice.call(d.querySelectorAll('li a')),at=-1,names=[];function fold(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();}try{names=['en',document.documentElement.lang].map(function(l){return new Intl.DisplayNames([l],{type:'language'});});}catch(e){}var keys=links.map(function(a){return fold([a.textContent,a.lang].concat(names.map(function(n){try{return n.of(a.lang)||'';}catch(e){return '';}})).join(' '));});function shown(){return links.filter(function(a){return !a.parentNode.hidden;});}function mark(a){links.forEach(function(l){l.classList.toggle('active',l===a);});at=links.indexOf(a);if(a)a.scrollIntoView({block:'nearest'});}function filter(){var terms=fold(input.value).split(/\\s+/).filter(Boolean);links.forEach(function(a,i){a.parentNode.hidden=!terms.every(function(t){return keys[i].indexOf(t)>=0;});});var left=shown();none.hidden=left.length>0;mark(terms.length?left[0]:d.querySelector('li [aria-current]'));}input.parentNode.hidden=false;input.addEventListener('input',filter);links.forEach(function(a){a.addEventListener('mousemove',function(){if(at!==links.indexOf(a))mark(a);});});d.addEventListener('toggle',function(){if(!d.open)return;input.value='';filter();if(!matchMedia('(pointer: coarse)').matches)input.focus();});d.addEventListener('keydown',function(e){var left=shown(),i=left.indexOf(links[at]);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();mark(left[Math.max(0,Math.min(left.length-1,i+(e.key==='ArrowDown'?1:-1)))]);}else if(e.key==='Enter'&&e.target===input){e.preventDefault();if(links[at]&&!links[at].parentNode.hidden)links[at].click();}else if(e.key==='Escape'&&d.open){d.open=false;d.querySelector('summary').focus();}});});menu.onclick=function(){menu.setAttribute('aria-expanded',String(bar.classList.toggle('open')));};document.addEventListener('click',function(e){bar.querySelectorAll('details[open]').forEach(function(d){if(!d.contains(e.target))d.open=false;});if(!bar.contains(e.target)&&bar.classList.contains('open'))menu.onclick();});})();</script>`;
}

// The front page's pictures as a carousel: the row moves on by itself
// every five seconds and starts over after the last, the dots under it say
// how many there are and which is shown, and the arrows and the dots go
// where they are pressed. It holds still under the pointer, while something
// in it has the focus, behind an open picture and in a hidden tab, stops for
// good once the visitor has moved it by hand, and never moves by itself for
// someone who has asked their system for less motion. The arrows stand at
// the middle of the picture, not of the picture and its caption. Without
// the script the arrows and dots stay hidden and the row scrolls as any other.
const SLIDER = `document.querySelectorAll('.side-scroll').forEach(function(box){var list=box.querySelector('.shots'),prev=box.querySelector('.prev'),next=box.querySelector('.next'),bar=box.querySelector('.dots'),dots=[].slice.call(bar.children),n=list.children.length,calm=matchMedia('(prefers-reduced-motion: reduce)'),held=false,stopped=false;function index(){var at=0,best=Infinity;for(var k=0;k<n;k++){var far=Math.abs(list.children[k].offsetLeft-list.scrollLeft);if(far<best){best=far;at=k;}}return at;}function to(i){list.scrollTo({left:list.children[(i+n)%n].offsetLeft,behavior:calm.matches?'auto':'smooth'});}function sync(){var img=list.querySelector('img'),at=index();box.style.setProperty('--side-mid',(img.offsetTop+img.offsetHeight/2)+'px');dots.forEach(function(dot,k){dot.setAttribute('aria-current',k===at?'true':'false');});}function by(dir){return function(){stopped=true;to(index()+dir);};}prev.onclick=by(-1);next.onclick=by(1);dots.forEach(function(dot,k){dot.onclick=function(){stopped=true;to(k);};});list.addEventListener('scroll',sync,{passive:true});list.addEventListener('pointerdown',function(){stopped=true;});list.addEventListener('keydown',function(){stopped=true;});box.addEventListener('mouseenter',function(){held=true;});box.addEventListener('mouseleave',function(){held=false;});box.addEventListener('focusin',function(){held=true;});box.addEventListener('focusout',function(){held=false;});addEventListener('resize',sync);prev.hidden=next.hidden=bar.hidden=false;sync();setInterval(function(){if(!stopped&&!held&&!calm.matches&&!document.hidden&&!document.querySelector('dialog[open]'))to(index()+1);},5000);});`;

// A screenshot's link still points at the picture, for a browser without
// <dialog> or scripts and for "open in a new tab"; a plain press opens it
// in the dialog instead.
const LIGHTBOX = `(function(){var links=[].slice.call(document.querySelectorAll('.shots a, .shot a'));if(!links.length||!window.HTMLDialogElement)return;var d=document.createElement('dialog');d.className='lightbox';d.setAttribute('aria-label',document.body.dataset.screenshot);function button(cls,label,path){var b=document.createElement('button');b.type='button';b.className='side-scroll-arrow '+cls;b.setAttribute('aria-label',label);var NS='http://www.w3.org/2000/svg',v=document.createElementNS(NS,'svg'),p=document.createElementNS(NS,'path');v.setAttribute('viewBox','0 0 20 20');v.setAttribute('aria-hidden','true');p.setAttribute('d',path);v.appendChild(p);b.appendChild(v);return b;}var say=document.body.dataset,close=button('lightbox-close',say.close,'M5 5l10 10M15 5 5 15'),prev=button('prev',say.previous,'m12 4-6 6 6 6'),next=button('next',say.next,'m8 4 6 6-6 6'),img=document.createElement('img'),cap=document.createElement('p'),at=0;d.append(close,img,cap,prev,next);document.body.appendChild(d);function show(i){at=i;var a=links[i],note=a.parentNode.querySelector('figcaption');img.src=a.href;img.alt=a.querySelector('img').alt;cap.textContent=note?note.textContent:'';prev.hidden=i<=0;next.hidden=i>=links.length-1;}links.forEach(function(a,i){a.addEventListener('click',function(e){if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;e.preventDefault();show(i);d.showModal();});});close.onclick=function(){d.close();};prev.onclick=function(){show(at-1);};next.onclick=function(){show(at+1);};d.addEventListener('click',function(e){if(e.target===d)d.close();});d.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'&&at>0)show(at-1);if(e.key==='ArrowRight'&&at<links.length-1)show(at+1);});})();`;

const STYLE = `  :root {
    --bg: #0a0c11;
    --panel: #11141c;
    --panel-2: #161a24;
    --border: #232838;
    --text: #e7eaf2;
    --muted: #9aa2b6;
    --dim: #6d7488;
    --accent: #8f74ff;
    --accent-2: #22d3ee;
    --warn: #e0a458;
  }

  * { box-sizing: border-box; }

  /* The landing part above the README: store buttons, the video, the
     screenshots. The README below stays the reference. */
  .hero { margin: 0 0 40px; }
  .lead { font-size: 18px; color: var(--muted); margin: 0 0 22px; }
  .stores { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 30px; }
  .stores a { display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border-radius: 10px; border: 1px solid transparent; background: var(--accent); color: #fff; font-weight: 600; text-decoration: none; }
  .stores a.alt, .prefers-firefox .stores a[data-store="chrome"] { background: var(--panel-2); border-color: var(--border); color: var(--text); }
  /* A visitor in Firefox, or on a phone, where Firefox's store is the way
     in, gets that button first; both stay on the page. */
  .prefers-firefox .stores a[data-store="firefox"] { background: var(--accent); border-color: transparent; color: #fff; order: -1; }
  .phone-note { display: none; margin: -18px 0 30px; padding: 10px 14px; border-radius: 10px; background: var(--panel); border: 1px solid var(--border); font-size: 14.5px; }
  .on-android .phone-note.android, .on-ios .phone-note.ios { display: block; }
  .shot { margin: 0 0 8px; }
  .shot + h2 { margin-top: 32px; }
  .shot a { display: block; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 18px 40px rgba(0, 0, 0, .28); }
  .shot img { display: block; width: 100%; height: auto; }
  .shot figcaption { color: var(--dim); font-size: 13px; margin-top: 8px; }
  .guides { margin: 36px 0 28px; }
  .guides h2 { margin-top: 0; }
  .guides ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  .guides li { margin: 0; }
  .guides a { display: block; height: 100%; padding: 14px 16px; border-radius: 10px; background: var(--panel); border: 1px solid var(--border); text-decoration: none; overflow: hidden; }
  .guides img { display: block; width: calc(100% + 32px); max-width: none; height: auto; aspect-ratio: 3 / 2; object-fit: contain; margin: -14px -16px 12px; background: var(--panel-2); border-bottom: 1px solid var(--border); transition: transform .2s; }
  .guides a:hover img { transform: scale(1.03); }
  @media (prefers-reduced-motion: reduce) { .guides img { transition: none; } }
  .guides a:hover, .guides a:focus-visible { border-color: var(--accent); }
  .guides a[aria-current] { border-color: var(--accent); }
  .guides strong { display: block; }
  .guides strong + span { margin-top: 4px; }
  .guides span { display: block; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
  /* A notice: what must not be missed, in a panel with its mark. Set apart
     by the panel alone, without a stripe down its side. */
  .note { display: flex; gap: 12px; align-items: flex-start; margin: 18px 0; padding: 14px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; }
  .note svg { flex: none; width: 20px; height: 20px; margin-top: 3px; fill: none; stroke: var(--link); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; color: var(--link); }
  .note.warning svg { stroke: var(--warn); color: var(--warn); }
  .note p { margin: 0; color: var(--text); }
  li + .note, ol + .note, ul + .note { margin-top: 18px; }

  /* The closing invitation is a panel of its own, as a dialog in the player is. */
  .cta { margin: 48px 0 0; padding: 22px 24px 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; }
  .cta h2 { margin: 0 0 8px; padding: 0; }
  .cta .stores { margin: 18px 0 0; }
  .cta .phone-note { margin: 12px 0 0; background: var(--panel-2); }
  .cta + .guides { margin-top: 48px; }

  /* Steps carry their number in a disc, so that "step 3" is found at a
     glance from the phone the page is followed on. */
  main ol { list-style: none; padding-left: 0; counter-reset: step; }
  main ol > li { counter-increment: step; position: relative; padding-left: 42px; margin-bottom: 14px; min-height: 28px; }
  main ol > li::before {
    content: counter(step); position: absolute; left: 0; top: -1px;
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    background: var(--panel-2); border: 1px solid var(--border);
    color: var(--text); font-size: 13.5px; font-weight: 650;
  }

  /* The questions fold: twenty answers open at once are a wall, and the one
     looked for is a press away. Closed answers are still in the page for a
     search engine and for the browser's find. */
  .qa { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; margin: 0 0 8px; }
  .qa[open] { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .qa summary { display: flex; align-items: center; gap: 14px; padding: 13px 18px; cursor: pointer; list-style: none; border-radius: 10px; }
  .qa summary::-webkit-details-marker { display: none; }
  .qa summary h2 { flex: 1; margin: 0; padding: 0; font-size: 16px; letter-spacing: 0; }
  .qa summary::after {
    content: ""; flex: none; width: 8px; height: 8px; margin: -4px 4px 0 0;
    border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
    transform: rotate(45deg); transition: transform .15s;
  }
  .qa[open] summary::after { transform: rotate(-135deg); margin-top: 4px; }
  .qa summary:hover::after { border-color: var(--text); }
  .qa summary:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  .qa > :not(summary) { margin-left: 18px; margin-right: 18px; }
  .qa > :last-child:not(summary) { margin-bottom: 16px; }
  @media (prefers-reduced-motion: reduce) { .qa summary::after { transition: none; } }
  .stores a:hover { filter: brightness(1.1); }
  .video { position: relative; display: block; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); margin: 0 0 12px; }
  .video img { display: block; width: 100%; height: auto; }
  .video .play { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(8, 9, 14, .35); }
  .video .play span { display: inline-flex; align-items: center; gap: 10px; padding: 12px 20px; border-radius: 999px; background: rgba(12, 12, 22, .85); border: 1px solid rgba(155, 135, 255, .45); color: #fff; font-weight: 600; }
  .video-note { color: var(--dim); font-size: 13px; margin: 0 0 30px; }
  /* The five store pictures one at a time in a row that scrolls sideways,
     with the player's own round arrows over its ends (css/playback.css,
     js/sidescroll.js). A swipe or the keyboard moves the row without them. */
  .side-scroll { position: relative; }
  .shots { display: flex; gap: 14px; margin: 0; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
  .shots::-webkit-scrollbar { display: none; }
  .shots figure { flex: 0 0 100%; margin: 0; scroll-snap-align: start; }
  .shots a { display: block; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
  .shots img { display: block; width: 100%; height: auto; }
  .shots figcaption { color: var(--muted); font-size: 14.5px; line-height: 1.5; margin-top: 10px; text-align: center; }
  .side-scroll-arrow {
    position: absolute; top: var(--side-mid, 40%); z-index: 1; width: 34px; height: 34px; padding: 0; transform: translateY(-50%);
    display: grid; place-items: center; border-radius: 999px; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--text) 24%, var(--border)); background: var(--panel); color: var(--text);
    box-shadow: 0 2px 10px rgba(0, 0, 0, .45);
  }
  .side-scroll-arrow[hidden], .dots[hidden] { display: none; }
  /* One dot a picture, the one shown drawn out in the accent: the row is
     seen to be several, and which. Each is 20 px tall to the finger and
     8 px to the eye. */
  .dots { display: flex; justify-content: center; gap: 8px; margin-top: 8px; }
  .dots { align-items: center; height: 20px; }
  .dots button { position: relative; width: 8px; height: 8px; padding: 0; border: 0; border-radius: 999px; cursor: pointer; background: color-mix(in srgb, var(--text) 30%, transparent); transition: width .2s; }
  .dots button::before { content: ""; position: absolute; inset: -6px -3px; }
  .dots button:hover { background-color: var(--muted); }
  .dots button[aria-current="true"] { width: 24px; background-color: var(--accent); }
  .dots button:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .dots button { transition: none; } }
  .side-scroll-arrow.prev { left: -14px; }
  .side-scroll-arrow.next { right: -14px; }
  .side-scroll-arrow:hover { background: var(--panel-2); border-color: var(--accent); }
  .side-scroll-arrow:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  /* A picture opens over the page, as a cover does in the player, instead
     of leaving for a bare image file: Esc, the cross or a press outside
     closes it, and the arrows walk the front page's five. */
  html:has(.lightbox[open]) { overflow: hidden; }
  .lightbox { padding: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); color: var(--text); max-width: min(1280px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: hidden; box-shadow: 0 24px 80px rgba(0, 0, 0, .6); }
  .lightbox::backdrop { background: rgba(5, 6, 10, .8); }
  .lightbox img { display: block; width: auto; height: auto; max-width: 100%; max-height: calc(100vh - 110px); }
  .lightbox p { margin: 0; padding: 10px 16px 12px; color: var(--muted); font-size: 14px; text-align: center; }
  .lightbox .side-scroll-arrow { top: calc(50% - 20px); }
  .lightbox .side-scroll-arrow.prev { left: 12px; }
  .lightbox .side-scroll-arrow.next { right: 12px; }
  .lightbox .lightbox-close { top: 12px; right: 12px; transform: none; }
  .shots a, .shot a { cursor: zoom-in; }
  .side-scroll-arrow svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    font-synthesis-weight: none;
  }

  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 22px 96px; }

/* site:nav */
${NAV_STYLE}
/* /site:nav */

  h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; margin: 22px 0 10px; }

  .meta { color: var(--dim); font-size: 13.5px; margin: 0 0 28px; }

  /* --------------------------------------------------------- contents */

  .toc {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px 20px; margin: 4px 0 8px;
    font-size: 14px;
  }
  .toc ul { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 28px; }
  .toc li { margin: 0 0 6px; break-inside: avoid; color: var(--muted); }
  @media (max-width: 560px) { .toc ul { columns: 1; } }

  /* ---------------------------------------------------------- content */

  h2 {
    font-size: 19px; letter-spacing: -0.01em; margin: 44px 0 12px;
    padding-top: 10px; scroll-margin-top: 16px;
  }

  h3 { font-size: 15.5px; margin: 26px 0 8px; color: var(--text); scroll-margin-top: 16px; }

  p, li { color: #cfd5e4; }
  p { margin: 0 0 14px; }

  ul, ol { margin: 0 0 14px; padding-left: 22px; }
  li { margin-bottom: 7px; }
  li::marker { color: var(--dim); }

  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 2px; }

  strong { color: var(--text); font-weight: 620; }
  em { color: var(--text); }

  code {
    font: 500 13.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 5px; padding: 1px 5px; color: #d7ccff;
  }
  h1 code, h2 code, h3 code { font-size: 0.85em; }

  pre {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 18px; margin: 0 0 18px;
    overflow-x: auto; color: #cfd5e4;
    font: 500 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  pre code { font: inherit; color: inherit; background: none; border: 0; padding: 0; }

  /* ------------------------------------------------------------ table */

  .table-scroll { overflow-x: auto; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; min-width: 420px; font-size: 14.5px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; background: var(--panel); }
  td:first-child { color: var(--text); font-weight: 560; }
  tr:last-child td { border-bottom: 0; }

  /* ----------------------------------------------------------- footer */

  footer {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px solid var(--border);
    color: var(--dim); font-size: 13.5px;
  }
  footer p { color: var(--dim); margin: 0 0 6px; }

  /* ------------------------------------------------------------ light */

  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff; --panel: #f6f7fa; --panel-2: #f0f2f7; --border: #dfe3ec;
      --text: #14171f; --muted: #5b6377; --dim: #767e91; --accent: #5b3fd6; --accent-2: #0f7c8c; --warn: #8f5a0b;
    }
    p, li, pre { color: #333a49; }
    code { color: #4a32b8; }
  }

  @media print {
    body { background: #fff; color: #000; font-size: 11pt; }
    .wrap { max-width: none; padding: 0; }
    .site, .toc, .guides, .cta { display: none; }
    .qa > :not(summary) { display: block; }
    p, li, pre, footer p { color: #000; }
    a { color: #000; }
    pre, .toc { border: 1px solid #999; }
    h2, h3 { page-break-after: avoid; }
  }
`;

function page({ path, title, description, image, source: from, heading, intro, main, jsonld, nav, alternates }) {
  return `<!doctype html>
<!-- Generated from ${from} by dev/site.mjs. Edit that file, not this one. -->
<html lang="${tag(lang)}" data-root="${base}" data-path="${path}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kepuli-TV">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${SITE}${langDir}${path}">
<meta property="og:image" content="${SITE}img/${image}.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${SITE}${langDir}${path}">
${alternates}
<link rel="icon" type="image/png" sizes="32x32" href="${base}img/icon32.png">
<link rel="icon" type="image/png" sizes="128x128" href="${base}img/icon128.png">
<link rel="stylesheet" href="${base}site.css">
<script>${BROWSER}</script>
<script defer src="${base}site.js"></script>${jsonld ? `\n<script type="application/ld+json">\n${jsonld}\n</script>` : ''}
</head>
<body data-close="${attr(S.close)}" data-previous="${attr(S.previous)}" data-next="${attr(S.next)}" data-screenshot="${attr(S.screenshot)}">
<!-- site:nav -->
${nav}
<!-- /site:nav -->
<div class="wrap">

<main>
<h1>${esc(heading)}</h1>
${intro}

${main}
</main>

<footer>
  <p>Kepuli-TV, © 2026 Samuli Vainio, ${esc(S.licence)}. <a href="${base}privacy/">${esc(S.privacy)}</a>, <a href="${base}terms/">${esc(S.terms)}</a>${S.inEnglish ? ` (${esc(S.inEnglish)})` : ''}</p>
  <p>${esc(S.affiliation)}</p>
</footer>

</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

/** Each second-level heading and what follows it, folded under the heading;
 *  the first few start open, so the page answers something before a press. */
function folded(parts, unfolded) {
  const out = [];
  let open = false;
  let n = 0;
  for (const part of parts) {
    if (part.startsWith('<h2 ')) {
      if (open) out.push('</details>');
      out.push(`<details class="qa"${n++ < unfolded ? ' open' : ''}>\n<summary>${part}</summary>`);
      open = true;
    } else out.push(part);
  }
  if (open) out.push('</details>');
  return out;
}

/** A guide's source: "key: value" lines between two "---" lines, then
 *  Markdown. The front matter is blanked rather than cut, so that a warning
 *  names the line of the file. */
function readGuide(file, translation = false) {
  const text = readFileSync(join(PAGES, file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`docs/pages/${file}: no front matter`);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  const wanted = translation ? ['title', 'description', 'alt'] : ['title', 'description', 'shot', 'alt', 'stores', 'order'];
  for (const key of wanted) if (!meta[key]) throw new Error(`docs/pages/${file}: front matter lacks "${key}"`);
  for (const key of Object.keys(meta)) if (translation && !wanted.includes(key)) throw new Error(`docs/pages/${file}: "${key}" belongs to the English guide alone`);
  if (!translation && !SHOTS.includes(meta.shot)) throw new Error(`docs/pages/${file}: no screenshot "${meta.shot}"`);
  const md = m[0].replace(/[^\n]/g, '') + text.slice(m[0].length);
  return { ...meta, name: file.replace(/\.md$/, '').replace(/^.*\//, ''), md, heading: plain(/^# (.+)$/m.exec(md)?.[1] ?? meta.title) };
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const outputs = new Map();
const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

// The English texts: the README's part for users (the front page in the
// other languages leaves out Development and Licence, which are for those
// who read the code, in English), and the guides.
const readme = readFileSync(SRC, 'utf8');
const readmeForUsers = readme.slice(0, readme.indexOf('\n## Development'));
const english = readdirSync(PAGES).filter((f) => f.endsWith('.md')).map((f) => readGuide(f)).sort((a, b) => a.order - b.order);

// What each translation is made from, by name, with the hash of its text:
// a translation whose record names another hash is behind.
const sources = { index: hash(readmeForUsers), site: hash(JSON.stringify(EN)) };
for (const g of english) sources[g.name] = hash(readFileSync(join(PAGES, `${g.name}.md`), 'utf8'));
const RECORD = join(PAGES, 'translations.json');
const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};

/** The shape a translation must keep: as many headings, lists, notices and
 *  so on as the English, and the same links (those within the page aside:
 *  they follow the translated headings). */
const shape = (rendered) => `${JSON.stringify(rendered.counts)} ${[...rendered.main.matchAll(/<a href="([^"#]+)/g)].map((m) => m[1].replace(/^(\.\.\/)+/, '').replace(new RegExp(`^${langDir}`), '')).sort().join(' ')}`;

/** Every "#…" link of a page lands on a heading of that page. */
function anchors(html) {
  for (const m of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${m[1]}"`)) warn(0, `#${m[1]} is not a heading of the page`);
}

const translated = readdirSync(PAGES).filter((d) => statSync(join(PAGES, d)).isDirectory());
for (const code of translated) if (!Object.hasOwn(LANGUAGES, code) || code === 'en') throw new Error(`docs/pages/${code}/: not a language of the player`);
// --try <lang> renders English and that language alone and writes nothing:
// a translation under way is checked without the others, finished or not.
const trying = process.argv.includes('--try') ? process.argv[process.argv.indexOf('--try') + 1] : '';
if (trying && !translated.includes(trying)) throw new Error(`--try ${trying}: no docs/pages/${trying}/`);
const NAMES = ['site.json', 'index.md', ...readdirSync(PAGES).filter((f) => f.endsWith('.md'))];
const complete = (code) => NAMES.every((name) => existsSync(join(PAGES, code, name)));
const unfinished = translated.filter((code) => !complete(code));
const languages = Object.keys(LANGUAGES).filter((code) => code === 'en' || (trying ? code === trying : translated.includes(code) && complete(code)));

/** The page's settings for a language and a depth below that language's root. */
function enter(code, depth) {
  lang = code;
  langDir = code === 'en' ? '' : `${code}/`;
  base = '../'.repeat(depth + (code === 'en' ? 0 : 1));
}

const words = { en: EN };
for (const code of languages) {
  if (code === 'en') continue;
  const file = `docs/pages/${code}/site.json`;
  const own = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  for (const key of Object.keys(EN)) if (typeof own[key] !== typeof EN[key] || (!own[key] && EN[key])) throw new Error(`${file}: "${key}" is missing`);
  if (own.captions.length !== EN.captions.length) throw new Error(`${file}: ${EN.captions.length} captions are needed`);
  words[code] = own;
}

// The English shapes, for the translations to be held against.
S = EN;
enter('en', 0);
source = 'README.md';
const frontShape = shape(render(parse(readmeForUsers)));
enter('en', 1);
const guideShape = Object.fromEntries(english.map((g) => { source = `docs/pages/${g.name}.md`; return [g.name, shape(render(parse(g.md), { contents: false }))]; }));

for (const code of languages) {
  S = words[code];
  const dir = code === 'en' ? 'docs/pages' : `docs/pages/${code}`;
  // A translated guide gives its title, description, alt and text; the
  // picture, the stores and the order are the English guide's.
  const guides = code === 'en' ? english : english.map((g) => ({ ...g, ...readGuide(`${code}/${g.name}.md`, true) }));
  const alternates = (path) => [...languages.map((other) => `<link rel="alternate" hreflang="${tag(other)}" href="${SITE}${other === 'en' ? '' : `${other}/`}${path}">`),
    `<link rel="alternate" hreflang="x-default" href="${SITE}${path}">`].join('\n');

  enter(code, 0);
  source = code === 'en' ? 'README.md' : `${dir}/index.md`;
  const front = render(parse(code === 'en' ? readme : readFileSync(join(PAGES, code, 'index.md'), 'utf8')));
  if (code !== 'en' && shape(front) !== frontShape) warn(0, 'not the shape of README.md up to Development (headings, lists, notices or links differ)');
  const frontHtml = page({
    path: '', title: S.frontTitle, description: front.description, image: SHOTS[0], source,
    heading: front.title,
    intro: `<p class="meta">${esc(S.meta.replace('{version}', version))} <a href="${REPO}" target="_blank" rel="noopener">${esc(S.source)}</a></p>\n\n${hero()}`,
    // The guides come after the introduction, above the contents.
    main: `${front.main.replace('<nav class="toc"', () => `${guideList(guides)}\n\n<nav class="toc"`)}\n\n${closing('home-end')}`,
    jsonld: software(front.description, version),
    nav: siteNav(guides, '', languages),
    alternates: alternates(''),
  });
  anchors(frontHtml);
  outputs.set(`${langDir}index.html`, frontHtml);

  enter(code, 1);
  for (const g of guides) {
    source = `${dir}/${g.name}.md`;
    const which = g.stores.split(',').map((s) => s.trim());
    const body = render(parse(g.md), { contents: false });
    if (code !== 'en' && shape(body) !== guideShape[g.name]) {
      warn(0, `not the shape of docs/pages/${g.name}.md (headings, lists, notices or links differ)`);
    }
    // The buttons and the picture follow the opening paragraph, which says
    // what the page is about before it asks for anything.
    const [opening, ...rest] = body.main.split('\n\n');
    if (!opening.startsWith('<p>')) throw new Error(`${source}: the page must open with a paragraph`);
    const html = page({
      path: `${g.name}/`, title: g.title, description: g.description, image: g.shot, source,
      heading: g.heading,
      // The questions come straight after the buttons: a picture between
      // them pushed the first question below the fold.
      intro: `${opening.replace('<p>', '<p class="lead">')}
${stores(g.name, which)}${g.layout === 'questions' ? '' : `
<figure class="shot">
  <a href="${base}img/${g.shot}.png"><img src="${base}img/${g.shot}.png" width="1280" height="800" alt="${attr(g.alt)}"></a>
  <figcaption>${esc(S.demo)}</figcaption>
</figure>`}`,
      main: `${(g.layout === 'questions' ? folded(rest, Number(g.open) || 0) : rest).join('\n\n')}\n\n${closing(`${g.name}-end`, which)}\n\n${guideList(guides, g)}`,
      nav: siteNav(guides, `${g.name}/`, languages),
      alternates: alternates(`${g.name}/`),
    });
    anchors(html);
    outputs.set(`${langDir}${g.name}/index.html`, html);
  }
}

// The policy pages keep their hand-written text; only the bar and its style
// between the markers are this script's.
function stamp(text, [open, close], content, file) {
  const a = text.indexOf(open); const b = text.indexOf(close);
  if (a < 0 || b < a) throw new Error(`docs/${file}: no ${open} … ${close}`);
  return `${text.slice(0, a + open.length)}\n${content}\n${text.slice(b)}`;
}
S = EN;
enter('en', 1);
for (const policy of ['privacy/', 'terms/']) {
  const file = `${policy}index.html`;
  let text = readFileSync(join(DOCS, file), 'utf8');
  text = stamp(text, ['/* site:nav */', '/* /site:nav */'], NAV_STYLE, file);
  text = stamp(text, ['<!-- site:nav -->', '<!-- /site:nav -->'], siteNav(english, policy, languages), file);
  outputs.set(file, text);
}

// One stylesheet and one script for every page, so that a page is its own
// text and little more: with them inside, three hundred pages carried the
// same 25 kB each.
outputs.set('site.css', `/* Written by dev/site.mjs. Edit it there, not here. */\n${NAV_STYLE}\n\n${STYLE}`);
outputs.set('site.js', `// Written by dev/site.mjs. Edit it there, not here.\n${SLIDER}\n${LIGHTBOX}\n`);

// Pages serves the site under a path of github.io, where a robots.txt is not
// read (only the host's root has one); the sitemap is given to the search
// engines' own consoles instead.
const paths = ['', ...english.map((g) => `${g.name}/`)];
outputs.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...languages.flatMap((code) => paths.map((p) => `${code === 'en' ? '' : `${code}/`}${p}`)), 'privacy/', 'terms/'].map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`);

// Which translations were made from an English text that has changed since.
const behind = languages.filter((code) => code !== 'en')
  .flatMap((code) => Object.keys(sources).filter((name) => record[code]?.[name] !== sources[name]).map((name) => `${code}/${name}`));

if (trying) {
  console.log(warnings ? `docs/pages/${trying}/: ${warnings} problems, listed above` : `docs/pages/${trying}/ is complete and shaped as the English`);
} else if (process.argv.includes('--mark')) {
  const asked = process.argv.slice(process.argv.indexOf('--mark') + 1);
  for (const code of asked.includes('all') ? languages.filter((c) => c !== 'en') : asked) {
    if (!languages.includes(code) || code === 'en') throw new Error(`--mark ${code}: no docs/pages/${code}/`);
    record[code] = { ...sources };
  }
  writeFileSync(RECORD, `${JSON.stringify(record, null, 1)}\n`);
  console.log(`docs/pages/translations.json: ${asked.join(', ')} marked as translated from the present English`);
} else if (process.argv.includes('--stale')) {
  console.log(behind.length ? `${behind.length} translations are behind the English:\n${behind.join('\n')}` : 'every translation is made from the present English');
} else if (process.argv.includes('--check')) {
  const stale = [...outputs].filter(([file, text]) => {
    try { return readFileSync(join(DOCS, file), 'utf8') !== text; } catch { return true; /* missing counts as stale */ }
  });
  for (const [file] of stale.slice(0, 20)) console.error(`docs/${file} is out of date: run node dev/site.mjs`);
  if (stale.length) process.exit(1);
  console.log(`the site is up to date: ${languages.length} languages, ${outputs.size} files` + (behind.length ? `; ${behind.length} translations are behind the English (--stale lists them)` : ''));
} else {
  copyShots();
  for (const [file, text] of outputs) {
    mkdirSync(dirname(join(DOCS, file)), { recursive: true });
    writeFileSync(join(DOCS, file), text);
  }
  if (unfinished.length) console.log(`left out, files missing in docs/pages/: ${unfinished.join(', ')}`);
  console.log(`docs/: ${languages.length} languages, ${english.length} guides each, ${outputs.size} files, front page ${(outputs.get('index.html').length / 1024).toFixed(1)} kB` +
    (behind.length ? `; ${behind.length} translations are behind the English (--stale lists them)` : '') + (warnings ? `, ${warnings} warnings` : ''));
}
process.exit(warnings ? 1 : 0);
