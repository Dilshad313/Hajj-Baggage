import * as api from '../api.js';
import { toast, icon, esc, skeletonBlock, errorState, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;
let mounted = false;
let me = null;
let config = null;
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  me = null; config = null; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy };
}

/** No timers to clean up. */
export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const [meRes, configRes] = await Promise.all([api.getMe(), api.getBookingLimits()]);
    if (!mounted) return;
    me = meRes; config = configRes;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Profile</h1>
    </div>
    <div id="profile-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(6);
  if (loadError) return errorState({ message: loadError });
  return `
    <div class="stack gap-4">
      <div class="card stack gap-2">
        <strong class="fs-lg">${esc(me.name)}</strong>
        <div class="fs-sm muted">${esc(me.group || '—')} · ${esc(me.agency || '—')}</div>
        <div class="row gap-2" style="margin-block-start:var(--s2)">
          <span class="fs-xs muted">Passport</span>
          <span class="fs-sm masked-passport">${esc(me.passportMasked)}</span>
        </div>
      </div>
      <div class="card row gap-3">
        ${icon('phone', 20)}
        <div>
          <div class="fs-xs muted">Support</div>
          <a class="fs-sm fw-medium mono" href="tel:${esc(String(config.supportPhone || '').replace(/\s+/g, ''))}">${esc(config.supportPhone)}</a>
        </div>
      </div>
      <div class="stack gap-3">
        <button type="button" class="btn btn-secondary btn-block" data-action="logout">${icon('log-out', 18)} Log out</button>
        <button type="button" class="btn btn-danger btn-block" data-action="reset-demo">${icon('rotate-ccw', 18)} Reset demo data</button>
      </div>
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelector('[data-action="logout"]')?.addEventListener('click', doLogout);
  appEl.querySelector('[data-action="reset-demo"]')?.addEventListener('click', doResetDemo);
}

async function doLogout() {
  const ok = await confirmDialog({
    title: 'Log out',
    body: 'Are you sure you want to log out?',
    confirmLabel: 'Log out',
  });
  if (!ok) return;
  api.logout();
  navigate('#/login');
}

async function doResetDemo() {
  const ok = await confirmDialog({
    title: 'Reset demo data',
    body: 'This resets all demo data back to the original seed, including bookings, bags, tickets and messages. Continue?',
    confirmLabel: 'Reset data',
    danger: true,
  });
  if (!ok) return;
  api.demoReset();
  toast('Demo data reset to the original seed.', 'success');
  navigate('#/login');
}
