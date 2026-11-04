// The strip at the top of the list column while a list loads: what is being
// fetched, how far it has come, and its own Cancel.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { el } from './dom.js';
import { megabytes, nf, percent } from './format.js';
import { renderEmptyState } from './topicbar.js';
import { t } from './i18n.js';

/** A known fraction (0…1), or null while the total is unknown. */
export function fillBar(ratio) {
  const bar = el.lpFill.parentElement;
  const known = Number.isFinite(ratio);
  bar.classList.toggle('indeterminate', !known);
  el.lpPercent.hidden = !known;
  if (!known) {
    bar.removeAttribute('aria-valuenow');
    el.lpPercent.textContent = '';
    el.lpFill.style.removeProperty('transform');
    return;
  }
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  const percent = Math.round(clamped * 100);
  el.lpFill.style.transform = `scaleX(${clamped.toFixed(4)})`;
  el.lpPercent.textContent = `${nf.format(percent)} %`;
  bar.setAttribute('aria-valuenow', String(percent));
}

// The load under the strip is cancellable: every request made while it is
// showing carries this controller's signal, and Cancel or Esc aborts them.
export let progressCtrl = null;
export const progressSignal = () => (progressCtrl ? progressCtrl.signal : undefined);

/**
 * The strip above the list, for a fetch the list is waiting on.
 *
 * This used to be a modal dialog over the whole app. Nothing about a list
 * arriving needs the player stopped: a search — which needs the type's whole
 * list, hundreds of kilobytes of it — was started by three letters typed into
 * a box, and took the volume, the subtitle selector and full screen with it
 * until it finished. The strip sits where the rows will appear, says the same
 * three things the dialog said, and leaves the rest of the window alone.
 */
export function showProgress(title, text, ratio = null) {
  el.lpTitle.textContent = title;
  el.lpText.textContent = text || '';
  fillBar(ratio);
  if (el.listProgress.hidden) {
    progressCtrl = new AbortController();
    el.listProgress.hidden = false;
    // The list was emptied before this strip appeared, so it is showing a
    // spinner of its own by now. One statement of the same fact is enough.
    renderEmptyState();
  }
}

export function cancelProgress() {
  if (progressCtrl) progressCtrl.abort();
}

export function updateProgress(received, total) {
  if (total > 0) {
    fillBar(received / total);
    el.lpText.textContent = t('progress.bytes', { received: megabytes(received), total: megabytes(total) });
  } else {
    fillBar(null);
    el.lpText.textContent = t('progress.received', { received: megabytes(received) });
  }
}

export function hideProgress() {
  progressCtrl = null;
  if (el.listProgress.hidden) return;
  el.listProgress.hidden = true;
  // A load that goes on without the strip gets the plain spinner back.
  renderEmptyState();
}
