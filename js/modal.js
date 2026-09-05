// Shared close control and dismissal gestures for the app's native dialogs.
// Each caller owns what closing means: discard a draft, ask for confirmation,
// abort a request, or simply close an image.
import { t } from './i18n.js';

const CLOSE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5 5 10 10M15 5 5 15"/></svg>';

export function wireModal(dialog, requestClose) {
  for (const button of dialog.querySelectorAll('[data-modal-close]')) {
    button.type = 'button';
    button.classList.add('modal-close');
    button.innerHTML = CLOSE_ICON;
    button.dataset.i18nTitle = button.dataset.i18nLabel = 'modal.close';
    button.title = t('modal.close');
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', requestClose);
  }
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    requestClose();
  });
  // Player shortcuts must not act on content behind a modal.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', event => { pressedOutside = outside(event); });
  dialog.addEventListener('pointercancel', () => { pressedOutside = false; });
  dialog.addEventListener('click', event => {
    if (pressedOutside && outside(event)) requestClose();
    pressedOutside = false;
  });
  dialog.addEventListener('close', () => { pressedOutside = false; });
}
