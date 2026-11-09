// The accounts in the player: the list under Settings › Connection with
// Use and Remove, and switching from one account to another with its own
// lists and cache. The accounts themselves
// are stored by js/config.js.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { t } from './i18n.js';
import * as store from './config.js';
import { accountAddress, adoptAccount, connect, startReset, state } from './state.js';
import { requestAccess } from './permissions.js';
import { cacheClear } from './db.js';
import { playback } from './playing.js';
import { configured, editAccount, pickAccount, setupAdding, setupDirty, setupEditing, setupError } from './setupui.js';
import { toast } from './toast.js';
import { $, el } from './dom.js';

/** What kind of account, and where: "Xtream Codes, example.tv". */
function accountWhere(a) {
  if (a.type === 'm3u' || a.type === 'stalker') {
    let host = a.fileId ? a.file : a.url;
    if (!a.fileId) try { host = new URL(a.url).hostname; } catch { /* the address as it is */ }
    const kind = t(a.type === 'm3u' ? 'accounts.kind.m3u' : 'accounts.kind.stalker');
    // An unnamed one is named by its host already.
    return store.accountLabel(a) === host ? kind : `${kind}, ${host}`;
  }
  // The host is in the name already when that is user@host.
  return store.accountLabel(a).endsWith(`@${a.host}`) ? t('accounts.kind.xtream') : `${t('accounts.kind.xtream')}, ${a.host}`;
}

/**
 * The accounts in Settings, each with what can be done with it: the one in
 * use is marked, the others can be switched to, and any can be removed.
 * Removing asks twice, like Reset everything, since an account's
 * favourites and history go with it.
 */
export function renderAccountList() {
  const box = $('accounts');
  const list = $('account-list');
  const accounts = state.accounts || [];
  box.hidden = !configured() || !accounts.length;
  list.replaceChildren();
  $('f-add-account').hidden = setupAdding;
  // The connection's explanation is the first run's; beside a list of
  // accounts it opens from the ? by their heading.
  $('connection-help').hidden = !box.hidden && $('accounts-help').getAttribute('aria-expanded') !== 'true';
  if (box.hidden) return;
  const row = (a, { isNew = false } = {}) => {
    const li = document.createElement('li');
    const inUse = !isNew && a.id === state.config.id;
    const selected = isNew ? setupAdding : (inUse ? setupEditing === 'current' : setupEditing === a.id);
    li.className = 'account-row' + (selected ? ' selected' : '') + (inUse ? ' current' : '');
    // The row itself picks the account for the form below; its buttons act.
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'account-main';
    main.setAttribute('aria-pressed', String(selected));
    const name = document.createElement('b');
    name.textContent = isNew ? t('accounts.new') : store.accountLabel(a);
    const where = document.createElement('span');
    where.textContent = isNew ? t('accounts.new.hint') : accountWhere(a);
    main.append(name, where);
    if (!isNew) main.addEventListener('click', () => pickAccount(inUse ? 'current' : a.id));
    li.append(main);
    if (isNew) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ghost';
      cancel.textContent = t('progress.cancel');
      cancel.addEventListener('click', () => editAccount('current'));
      li.append(cancel);
    } else {
      if (inUse) {
        const badge = document.createElement('span');
        badge.className = 'account-current';
        badge.textContent = t('accounts.current');
        li.append(badge);
      } else {
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'ghost';
        use.textContent = t('accounts.use');
        use.addEventListener('click', () => {
          if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
          switchAccount(a.id);
        });
        li.append(use);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost danger';
      remove.textContent = t('accounts.remove');
      let armed = null;
      remove.addEventListener('click', async () => {
        if (!armed) {
          remove.textContent = t('accounts.remove.confirm');
          remove.classList.add('armed');
          armed = setTimeout(() => { armed = null; remove.textContent = t('accounts.remove'); remove.classList.remove('armed'); }, 4000);
          return;
        }
        clearTimeout(armed);
        if (inUse) { await removeAccountInUse(a); return; }
        await removeAccount(a);
        if (setupEditing === a.id) editAccount('current');
        else renderAccountList();
      });
      li.append(remove);
    }
    return li;
  };
  for (const a of accounts) list.append(row(a));
  if (setupAdding) list.append(row(null, { isNew: true }));
}


/**
 * An account off the list with its favourites and history (js/config.js)
 * and its catalogue in the cache, which is kept under the account's key:
 * left there, a playlist file read in stayed in the browser's storage for
 * good. Both stay while another entry of the list is the same account.
 */
async function removeAccount(a) {
  state.accounts = await store.removeAccount(a.id);
  const key = store.accountKey(a);
  if (!state.accounts.some((other) => store.accountKey(other) === key)) await cacheClear(`${key}|`);
  toast(t('accounts.removed', { name: store.accountLabel(a) }));
}

/**
 * The account in use removed. With another in the list, that one is taken
 * into use first, as Use would, and the removed one goes after it; the
 * last one leaves the player as it was before the first: the page starts
 * again at the welcome, the language, theme and the other settings kept.
 * Nothing of the player's may be written back meanwhile (startReset): the
 * place in what was playing would make the account's lists again.
 */
async function removeAccountInUse(a) {
  if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
  const next = (state.accounts || []).find((other) => other.id !== a.id);
  if (next) {
    if (el.setup.open) el.setup.close();
    const config = await store.switchConfig(next);
    await adoptAccount(config);
    el.mode.value = state.config.streamMode || 'auto';
    await removeAccount(a);
    await connect();
    return;
  }
  startReset();
  playback.stop();
  state.accounts = await store.removeAccount(a.id);
  await cacheClear(`${store.accountKey(a)}|`);
  await store.forgetConfig();
  location.reload();
}

/**
 * Another account of the list in use: what is playing stops, the lists
 * are the other account's, and the catalogue is its own — from the cache
 * when it was opened lately, since each account's is kept apart.
 */
async function switchAccount(id) {
  const target = (state.accounts || []).find((a) => a.id === id);
  if (!target || target.id === state.config.id) return;
  if (el.setup.open) el.setup.close();
  const config = await store.switchConfig(target);
  await adoptAccount(config);
  el.mode.value = state.config.streamMode || 'auto';
  toast(t('accounts.switched', { name: store.accountLabel(config) }));
  await connect();
}

/**
 * A playlist that is an Xtream panel's list (js/m3u.js, xtreamPanel) says
 * so once, after its first connection, with the way to the server itself:
 * a list downloaded as type=m3u has no categories for its films and
 * series, no covers and no guide ids, and the server's API has them all.
 * The server becomes an account of its own beside the playlist, or the
 * one in the list already is taken into use; nothing changes unasked.
 * Once per account in this browser (the ui state), taken up or not.
 * @param {{ scheme: string, host: string, port: string, username: string, password: string } | null | undefined} panel
 */
export async function offerXtream(panel) {
  const config = state.config;
  if (!panel || config.type !== 'm3u') return;
  const playlist = store.accountKey(config);
  const ui = await store.loadUiState();
  const offered = Array.isArray(ui.xtreamOffered) ? ui.xtreamOffered : [];
  if (offered.includes(playlist)) return;
  await store.saveUiState({ xtreamOffered: [...offered, playlist] });
  const server = { ...store.blankConfig(), type: 'xtream', sourceMode: 'xtream', ...panel };
  const offer = (text) => toast(text, { long: true, action: { label: t('m3u.xtream.use'), onClick: () => useXtream(server, offer) } });
  offer(t('m3u.xtream.offer', { host: panel.host }));
}

async function useXtream(server, offer) {
  // Asked in the press itself, while the browser still counts it as one.
  if (!(await requestAccess(accountAddress(server)))) {
    offer(t('setup.nogrant', { button: t('m3u.xtream.use') }));
    return;
  }
  const key = store.accountKey(server);
  const known = (state.accounts || []).find((a) => store.accountKey(a) === key);
  if (known) { await switchAccount(known.id); return; }
  if (el.setup.open) el.setup.close();
  const { config } = await store.saveSetup(server, {}, { replace: true });
  state.accounts = await store.loadAccounts();
  await adoptAccount(config);
  el.mode.value = state.config.streamMode || 'auto';
  await connect();
}
