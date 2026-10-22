/**
 * App bootstrap: shell chrome (bottom tab bar / sidebar), auth guard, router
 * wiring, polling, global listeners.
 */
import { isAuthed, getSession, isDemoMode, setDemoMode } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as runsView from './views/runs.js';
import * as runOverviewView from './views/run-overview.js';
import * as trolleyView from './views/trolley.js';
import * as outView from './views/out.js';
import * as stopView from './views/stop.js';
import * as returnView from './views/return.js';
import * as reconcileView from './views/reconcile.js';
import * as alertsView from './views/alerts.js';
import * as scanView from './views/scan.js';
import * as historyView from './views/history.js';
import * as profileView from './views/profile.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_ITEMS = [
  { id: 'runs', hash: '#/', match: '/', label: 'Runs', iconName: 'list-checks' },
  { id: 'current', label: 'Current run', iconName: 'navigation' },
  { id: 'scan', hash: '#/scan', match: '/scan', label: 'Scan', iconName: 'scan-line' },
  { id: 'alerts', hash: '#/alerts', match: '/alerts', label: 'Alerts', iconName: 'bell' },
  { id: 'profile', hash: '#/profile', match: '/profile', label: 'Profile', iconName: 'user-circle' },
];

let shellMounted = false;
let iconObserver = null;
let iconRenderScheduled = false;

function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

/**
 * Renders any pending `data-lucide` placeholders. Disconnects the mutation
 * observer first so lucide's own DOM replacement never re-triggers itself —
 * without this, observing document.body for every mutation while a library
 * that mutates the DOM in response is a feedback loop that can pin the main
 * thread solid under heavy re-rendering (the per-stop scan/verify/sign flow
 * re-renders very frequently).
 */
function renderIcons() {
  if (!window.lucide?.createIcons) return;
  iconObserver?.disconnect();
  window.lucide.createIcons();
  iconObserver?.observe(document.body, { childList: true, subtree: true });
}

function scheduleIconRender() {
  if (iconRenderScheduled) return;
  iconRenderScheduled = true;
  requestAnimationFrame(() => {
    iconRenderScheduled = false;
    renderIcons();
  });
}

function mountBare() {
  shellMounted = false;
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="bare-root"><main id="app" tabindex="-1"></main></div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
}

function navItemHtml(item, path) {
  const isCurrent = item.hash ? (item.match === '/' ? path === '/' : path.startsWith(item.match)) : path.startsWith('/run/');
  const attrs = `class="nav-item" ${isCurrent ? 'aria-current="page"' : ''}`;
  const inner = `${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>`;
  if (item.hash) return `<a href="${item.hash}" ${attrs}>${inner}</a>`;
  return `<button type="button" data-nav="${item.id}" ${attrs}>${inner}</button>`;
}

function navListHtml() {
  const path = currentPath();
  return NAV_ITEMS.map((item) => navItemHtml(item, path)).join('');
}

async function goToCurrentRun() {
  try {
    const runs = await api.getRuns({ tab: 'today' });
    const active = runs.find((r) => r.status === 'In Progress') || runs.find((r) => r.status === 'Notified');
    if (active) navigate(`#/run/${active.id}`);
    else toast('No active run right now.', 'info');
  } catch (e) {
    toast('Could not load your runs.', 'error');
  }
}

function wireNav(root) {
  root.querySelectorAll('[data-nav="current"]').forEach((btn) => btn.addEventListener('click', goToCurrentRun));
}

function mountShell() {
  if (shellMounted) { updateNavHighlight(); return; }
  shellMounted = true;
  const session = getSession();
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="app-shell">
      <nav class="sidebar" aria-label="Primary">
        <div class="brand">
          <span class="brand-name">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <div class="stack gap-1" id="nav-list-sidebar">${navListHtml()}</div>
        <div class="grow"></div>
        <button type="button" class="btn btn-ghost" id="profile-menu-btn-sidebar" style="justify-content:flex-start">
          ${icon('settings', 18)} <span class="fs-sm">${esc(session?.name || 'Staff')}</span>
        </button>
      </nav>
      <div id="main-col">
        <header class="topbar">
          <span class="row gap-2"><span class="badge-env">DEMO</span><span class="fs-sm muted">${esc(session?.hotel || '')}</span></span>
          <button type="button" class="btn btn-ghost btn-icon" id="profile-menu-btn-top" aria-label="Menu" aria-haspopup="true" aria-expanded="false">
            ${icon('more-vertical', 20)}
          </button>
        </header>
        <main id="app" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav" aria-label="Primary" id="nav-list-bottom">${navListHtml()}</nav>
    </div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
  renderIcons();
  wireNav(document.getElementById('nav-list-sidebar'));
  wireNav(document.getElementById('nav-list-bottom'));
  document.getElementById('profile-menu-btn-top')?.addEventListener('click', (e) => { e.stopPropagation(); openProfileMenu(e.currentTarget); });
  document.getElementById('profile-menu-btn-sidebar')?.addEventListener('click', (e) => { e.stopPropagation(); openProfileMenu(e.currentTarget); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-dropdown') && !e.target.closest('[id^="profile-menu-btn"]')) closeProfileMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfileMenu(); });
}

function updateNavHighlight() {
  const a = document.getElementById('nav-list-sidebar');
  const b = document.getElementById('nav-list-bottom');
  if (a) { a.innerHTML = navListHtml(); wireNav(a); }
  if (b) { b.innerHTML = navListHtml(); wireNav(b); }
  renderIcons();
}

function closeProfileMenu() {
  document.querySelectorAll('.bell-dropdown').forEach((el) => el.remove());
  document.querySelectorAll('[id^="profile-menu-btn"]').forEach((el) => el.setAttribute('aria-expanded', 'false'));
}

function openProfileMenu(anchorBtn) {
  closeProfileMenu();
  anchorBtn.setAttribute('aria-expanded', 'true');
  const dd = document.createElement('div');
  dd.className = 'bell-dropdown';
  dd.style.position = 'absolute';
  const rect = anchorBtn.getBoundingClientRect();
  dd.style.top = `${rect.bottom + window.scrollY + 8}px`;
  dd.style.insetInlineEnd = `${Math.max(8, window.innerWidth - rect.right)}px`;
  const demoOn = isDemoMode();
  dd.innerHTML = `
    <a class="bell-item" href="#/history">${icon('history', 16)} Delivery history</a>
    <button type="button" class="bell-item" data-act="toggle-demo">
      ${icon('flask-conical', 16)} <span style="flex:1">Demo mode</span> ${demoOn ? statusOnBadge() : ''}
    </button>
    ${demoOn ? `
      <button type="button" class="bell-item" data-act="demo-create-run">${icon('plus-circle', 16)} Create a delivery run for me</button>
      <button type="button" class="bell-item" data-act="demo-scan-out">${icon('scan-line', 16)} Scan all bags out</button>
      <button type="button" class="bell-item" data-act="demo-deliver-run">${icon('check-check', 16)} Deliver whole run</button>
      <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    ` : ''}
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  document.body.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'logout') { closeProfileMenu(); api.logout(); window.location.href = '../index.html'; return; }
    if (act === 'toggle-demo') {
      setDemoMode(!demoOn);
      toast(`Demo mode ${!demoOn ? 'on' : 'off'}.`, 'info');
      closeProfileMenu();
      const current = getCurrent();
      if (current && current.refresh) current.refresh();
      return;
    }
    if (act === 'demo-create-run') { const r = await api.demoCreateRun(); toast('A new delivery run was created.', 'success'); closeProfileMenu(); navigate(`#/run/${r.runId}`); return; }
    if (act === 'demo-scan-out') { await api.demoScanAllOut(); toast('All bags scanned out for delivery.', 'info'); }
    if (act === 'demo-deliver-run') {
      const runs = await api.getRuns({ tab: 'today' });
      const target = runs.find((r) => r.status === 'In Progress') || runs[0];
      if (target) { await api.demoDeliverWholeRun(target.id); toast(`${target.code} delivered in full.`, 'success'); }
      else toast('No run available to deliver.', 'error');
    }
    if (act === 'demo-reset') {
      api.demoReset();
      toast('Demo data reset to the original seed.', 'success');
      closeProfileMenu();
      navigate('#/');
      return;
    }
    closeProfileMenu();
    const current = getCurrent();
    if (current && current.refresh) current.refresh();
  });
}

function statusOnBadge() { return `<span class="chip chip-green" style="margin-inline-start:auto">On</span>`; }

function wrapView(view) {
  return (params, app) => {
    mountShell();
    updateNavHighlight();
    const result = view.render(params, document.getElementById('app'));
    return result || { destroy: view.destroy };
  };
}

function registerRoutes() {
  route('/login', (params, app) => {
    mountBare();
    return loginView.render(params, document.getElementById('app')) || { destroy: loginView.destroy };
  });
  route('/', wrapView(runsView));
  route('/run/:id', wrapView(runOverviewView));
  route('/run/:id/trolley', wrapView(trolleyView));
  route('/run/:id/out', wrapView(outView));
  route('/run/:id/stop/:stopId', wrapView(stopView));
  route('/run/:id/return', wrapView(returnView));
  route('/run/:id/reconcile', wrapView(reconcileView));
  route('/alerts', wrapView(alertsView));
  route('/scan', wrapView(scanView));
  route('/history', wrapView(historyView));
  route('/profile', wrapView(profileView));

  setNotFound((app) => {
    mountShell();
    app.innerHTML = `
      <div class="state-block">
        <h1 class="fs-xl">404 — Page not found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a class="btn btn-primary" href="#/">Back to runs</a>
      </div>`;
  });

  setGuard((path) => {
    if (path !== '/login' && !isAuthed()) return '#/login';
    if (path === '/login' && isAuthed()) return '#/';
    return true;
  });
}

/** True while the user is mid-interaction (typing, or a modal/drawer open) — skip polling so a background refresh can't steal focus or close an open dialog. */
function isUserBusy() {
  const el = document.activeElement;
  if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return !!document.querySelector('.overlay, .drawer-overlay');
}

function startPolling() {
  setInterval(() => {
    if (document.visibilityState !== 'visible' || isUserBusy()) return;
    const current = getCurrent();
    if (current && current.poll) current.poll();
  }, 15000);
  window.addEventListener('focus', () => {
    const current = getCurrent();
    if (current && current.poll) current.poll();
  });
}

function init() {
  registerRoutes();
  startRouter();
  startPolling();
  iconObserver = new MutationObserver(() => scheduleIconRender());
  iconObserver.observe(document.body, { childList: true, subtree: true });
}

init();
