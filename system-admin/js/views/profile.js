import * as api from '../api.js';
import { skeletonBlock, errorState, toast, icon, esc } from '../ui.js';

let appEl = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

/** Tears down the view. */
export function destroy() { appEl = null; }

function pageHeader() {
  return `<div class="page-header"><div><h1 class="page-title">My profile</h1><p class="page-subtitle">Your admin account details.</p></div></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageHeader() + skeletonBlock(4);
  try {
    const me = await api.getMe();
    renderData(me);
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderData(me) {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="card" style="max-width:480px">
      <dl class="handover-summary">
        <dt>Name</dt><dd>${esc(me.name)}</dd>
        <dt>Employee ID</dt><dd class="mono">${esc(me.employeeId)}</dd>
      </dl>
      <p class="fs-sm muted row gap-2" style="align-items:center">${icon('shield-check', 16)} Two-factor authentication is enabled for this account.</p>
      <button type="button" class="btn btn-secondary" data-act="logout" style="margin-block-start:var(--s4)">${icon('log-out', 16)} Log out</button>
    </div>`;
  appEl.querySelector('[data-act="logout"]').addEventListener('click', () => {
    api.logout();
    toast('You have been logged out.', 'info');
    window.location.href = '../index.html';
  });
}
