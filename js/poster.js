// Decorative covers share one fallback in lists and detail views.
// Their dimensions belong to the container, so loading cannot move the text.
import { t } from './i18n.js';
import { wireModal } from './modal.js';

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
  if (interactive) {
    frame.type = 'button';
    frame.disabled = true;
    frame.title = t('poster.open', { title });
    frame.setAttribute('aria-label', frame.title);
    frame.setAttribute('aria-haspopup', 'dialog');
  } else frame.setAttribute('aria-hidden', 'true');
  frame.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind] || ICONS.movie}</svg>`;
  if (!url) return frame;

  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  frame.classList.add('loading');
  img.addEventListener('load', () => {
    frame.classList.remove('loading');
    frame.classList.add('loaded');
    if (interactive) frame.disabled = false;
  }, { once: true });
  img.addEventListener('error', () => {
    frame.classList.remove('loading', 'loaded');
    img.remove();
  }, { once: true });
  img.src = url;
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
