// @ts-check
// Decorative covers share one fallback in lists and detail views.
// Their dimensions belong to the container, so loading cannot move the text.
import { t } from './i18n.js';
import { wireModal } from './modal.js';
import { svg } from './svg.js';

// Firefox takes an http image on a secure page, which the extension's own
// is, as mixed content and asks for it over https instead, with no going
// back: a provider's logos and covers on plain http never showed, on the
// desktop and on Android alike (measured 2026-11-07, Firefox 152 and 159;
// the mock on 127.0.0.1 hid it, a loopback address not being upgraded).
// Chrome loads them as they are. A fetch is not upgraded, so in Firefox
// such an image comes through one, as a blob. It needs the host's access
// (the provider's, granted at connecting) or the host's CORS; without
// either the cover keeps its fallback, as before.
const UPGRADED = /^http:\/\/(?!(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])(?::\d+)?\/)/i;
const MAX_BLOBS = 400;
// isGecko() of js/browser.js, asked here: importing that module from this one
// set it up before the unit tests' stand-in for the extension API.
const gecko = () => typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');
/** @type {Map<string, Promise<string|null>>} */
const blobs = new Map();

/** The image at url as a blob: URL, or null; one fetch an address, the last MAX_BLOBS kept. */
function viaFetch(url) {
  let made = blobs.get(url);
  if (!made) {
    made = fetch(url, { credentials: 'omit' })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob && blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    blobs.set(url, made);
    if (blobs.size > MAX_BLOBS) {
      const [oldest, old] = blobs.entries().next().value;
      blobs.delete(oldest);
      // A picture showing it is drawn already; a new row fetches again.
      old.then((u) => { if (u) setTimeout(() => URL.revokeObjectURL(u), 60e3); });
    }
  }
  return made;
}

const ICONS = {
  channel: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 2 4 4 4-4M7 10h7v6H7zM17 11h.01M17 15h.01"/>',
  movie: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4"/>',
  series: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M6 3h12M5 5h14M10 11l5 3-5 3z"/>',
};

export function poster(className, src, kind = 'movie', { expand = false, title = '' } = {}) {
  const url = typeof src === 'string' ? src.trim() : '';
  const interactive = expand && Boolean(url);
  const frame = document.createElement(interactive ? 'button' : 'span');
  frame.className = `poster ${className}`;
  if (kind === 'channel') frame.classList.add('channel-logo');
  if (frame instanceof HTMLButtonElement) {
    frame.type = 'button';
    frame.disabled = true;
    frame.title = t('poster.open', { title });
    frame.setAttribute('aria-label', frame.title);
    frame.setAttribute('aria-haspopup', 'dialog');
  } else frame.setAttribute('aria-hidden', 'true');
  frame.append(svg(ICONS[kind] || ICONS.movie, '0 0 24 24'));
  if (!url) return frame;

  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  frame.classList.add('loading');
  img.addEventListener('load', () => {
    frame.classList.remove('loading');
    frame.classList.add('loaded');
    if (frame instanceof HTMLButtonElement) frame.disabled = false;
  }, { once: true });
  const fail = () => {
    frame.classList.remove('loading', 'loaded');
    img.remove();
  };
  img.addEventListener('error', fail, { once: true });
  if (gecko() && UPGRADED.test(url)) viaFetch(url).then((blob) => { if (blob) img.src = blob; else fail(); });
  else img.src = url;
  frame.appendChild(img);
  if (interactive) frame.addEventListener('click', () => showPoster(img, title));
  return frame;
}

function showPoster(source, title) {
  const dialog = document.createElement('dialog');
  dialog.className = 'poster-dialog';
  dialog.setAttribute('aria-label', t('poster.title', { title }));
  const image = document.createElement('img');
  image.src = source.currentSrc || source.src;
  image.alt = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'poster-close';
  close.setAttribute('data-modal-close', '');
  close.autofocus = true;
  const header = document.createElement('div');
  header.className = 'modal-head';
  const heading = document.createElement('h2');
  heading.textContent = t('poster.title', { title });
  header.append(heading, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.append(header, image);
  wireModal(dialog, () => dialog.close());
  document.body.append(dialog);
  dialog.showModal();
}
