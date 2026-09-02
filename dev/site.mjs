#!/usr/bin/env node
// The GitHub Pages front page: README.md rendered as docs/index.html, in the
// same style as the privacy policy and the terms of use, which are
// hand-written HTML in docs/tietosuoja/ and docs/kayttoehdot/.
//
// The converter covers what the README uses — headings, paragraphs, lists,
// tables, fenced code, inline code, bold, italics and links — and nothing
// more. A construct it does not know is reported on stderr rather than
// mangled quietly. No dependencies: Node 22+ is enough.
//
//   node dev/site.mjs           writes docs/index.html
//   node dev/site.mjs --check   exits 1 if docs/index.html is out of date

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'README.md');
const OUT = join(ROOT, 'docs', 'index.html');
const REPO = 'https://github.com/BigTimeSam/kepuli-tv';

let warnings = 0;
const warn = (line, msg) => { warnings++; console.error(`README.md:${line}: ${msg}`); };

/* ----------------------------------------------------------------- inline */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A relative link points into the repository on GitHub: docs/ holds no copy of it. */
const href = (h) => (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(h) ? h : `${REPO}/blob/main/${h}`);

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
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${href(h)}">${t}</a>`)
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

    if (UNSUPPORTED.test(line)) warn(i + 1, `unsupported construct, rendered as a paragraph: ${line.trim().slice(0, 40)}`);
    const para = [line]; i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(i)) para.push(lines[i++]);
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

/* ----------------------------------------------------------------- render */

function render(blocks) {
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
  const counts = { heading: 0, p: 0, list: 0, table: 0, code: 0 };

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
  let tocDone = toc.length < 3;
  for (const part of body) {
    if (!tocDone && part.tag === 'h2') {
      main.push(`<nav class="toc" aria-label="Contents">\n<ul>\n${toc.map((t) => `  <li><a href="#${t.id}">${t.text}</a></li>`).join('\n')}\n</ul>\n</nav>`);
      tocDone = true;
    }
    main.push(part.html);
  }
  return { title, description, main: main.join('\n\n'), counts };
}

/* --------------------------------------------------------------- template */

function page({ title, description, main }, version) {
  return `<!doctype html>
<!-- Generated from README.md by dev/site.mjs. Edit the README, not this file. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description).replace(/"/g, '&quot;')}">
<meta name="robots" content="index,follow">
<style>
  :root {
    --bg: #0a0c11;
    --panel: #11141c;
    --panel-2: #161a24;
    --border: #232838;
    --text: #e7eaf2;
    --muted: #9aa2b6;
    --dim: #6d7488;
    --accent: #8f74ff;
    --accent-2: #22d3ee;
  }

  * { box-sizing: border-box; }

  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    font-synthesis-weight: none;
  }

  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 22px 96px; }

  /* ---------------------------------------------------------- header */

  header { border-bottom: 1px solid var(--border); padding-bottom: 28px; margin-bottom: 36px; }

  .brand {
    display: inline-flex; align-items: center; gap: 9px;
    font-weight: 650; letter-spacing: -0.01em; font-size: 15px;
    color: var(--text); text-decoration: none;
  }
  .brand-mark {
    width: 22px; height: 22px; border-radius: 5px; flex: none;
    background: linear-gradient(150deg, var(--accent), #5b3fd6);
    display: grid; place-items: center;
  }
  .brand-mark svg { width: 13px; height: 13px; stroke: #fff; fill: none; stroke-width: 1.9; stroke-linejoin: round; }

  h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; margin: 22px 0 10px; }

  .meta { color: var(--dim); font-size: 13.5px; margin: 0 0 28px; }
  .meta a { color: var(--muted); }

  .langs { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 13.5px; }
  .langs a {
    color: var(--muted); text-decoration: none;
    border: 1px solid var(--border); background: var(--panel);
    padding: 4px 11px; border-radius: 999px;
  }
  .langs a:hover { color: var(--text); border-color: var(--accent); }

  /* --------------------------------------------------------- contents */

  .toc {
    background: var(--panel); border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 10px; padding: 16px 20px; margin: 4px 0 8px;
    font-size: 14px;
  }
  .toc ul { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 28px; }
  .toc li { margin: 0 0 6px; break-inside: avoid; color: var(--muted); }
  .toc a { color: var(--muted); text-decoration: none; }
  .toc a:hover { color: var(--text); }
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

  a { color: var(--accent-2); text-decoration-thickness: 1px; text-underline-offset: 2px; }

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
  footer a { color: var(--muted); }

  /* ------------------------------------------------------------ light */

  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff; --panel: #f6f7fa; --panel-2: #f0f2f7; --border: #dfe3ec;
      --text: #14171f; --muted: #5b6377; --dim: #767e91; --accent: #5b3fd6; --accent-2: #0f7c8c;
    }
    p, li, pre { color: #333a49; }
    code { color: #4a32b8; }
  }

  @media print {
    body { background: #fff; color: #000; font-size: 11pt; }
    .wrap { max-width: none; padding: 0; }
    .langs, .toc { display: none; }
    p, li, pre, footer p { color: #000; }
    a { color: #000; }
    pre, .toc { border: 1px solid #999; }
    h2, h3 { page-break-after: avoid; }
  }
</style>
</head>
<body>
<div class="wrap">

<header>
  <a class="brand" href="./">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="2.5" y="6.5" width="19" height="13" rx="2"/><path d="M8 3l4 3.5L16 3"/></svg>
    </span>
    Kepuli-TV
  </a>
  <nav class="langs">
    <a href="tietosuoja/">Privacy Policy</a>
    <a href="kayttoehdot/">Terms of Use</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>

<main>
<h1>${esc(title)}</h1>
<p class="meta">The README of the Kepuli-TV browser extension · Version ${esc(version)} · <a href="${REPO}">Source on GitHub</a></p>

${main}
</main>

<footer>
  <p>Kepuli-TV · © 2026 Samuli Vainio · MIT licence · <a href="tietosuoja/">Privacy Policy</a> · <a href="kayttoehdot/">Terms of Use</a></p>
  <p>This page is the repository's README.md, rendered by dev/site.mjs.</p>
</footer>

</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

const md = readFileSync(SRC, 'utf8');
const { version } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const rendered = render(parse(md));
const html = page(rendered, version);

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== html) { console.error('docs/index.html is out of date: run node dev/site.mjs'); process.exit(1); }
  console.log('docs/index.html is up to date');
} else {
  writeFileSync(OUT, html);
  const c = rendered.counts;
  console.log(`docs/index.html  ${(html.length / 1024).toFixed(1)} kB  ` +
    `${c.heading} headings, ${c.p} paragraphs, ${c.list} lists, ${c.table} tables, ${c.code} code blocks` +
    (warnings ? `, ${warnings} warnings` : ''));
}
process.exit(warnings ? 1 : 0);
