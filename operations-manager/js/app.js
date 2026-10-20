/**
 * App bootstrap: shell chrome, auth guard, router wiring, polling, global listeners.
 */
import { isAuthed, getSession, getStore, getDirection, setDirection } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, fmtRelative, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as dashboardView from './views/dashboard.js';
import * as bagsView from './views/bags.js';
import * as exceptionsView from './views/exceptions.js';
import * as trucksView from './views/trucks.js';
import * as cutoffsView from './views/cutoffs.js';
import * as reconciliationView from './views/reconciliation.js';
import * as closureView from './views/closure.js';
import * as reportsView from './views/reports.js';
import * as stakeholdersView from './views/stakeholders.js';
import * as handoverView from './views/handover.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_ITEMS = [
  { hash: '#/', match: '/', label: 'Dashboard', iconName: 'layout-dashboard' },
  { hash: '#/bags', match: '/bags', label: 'Bags', iconName: 'package' },
  { hash: '#/exceptions', match: '/exceptions', label: 'Exceptions', iconName: 'alert-triangle' },
  { hash: '#/trucks', match: '/trucks', label: 'Trucks', iconName: 'truck' },
  { hash: '#/cutoffs', match: '/cutoffs', label: 'Cut-offs', iconName: 'timer', departureOnly: true },
  { hash: '#/reconciliation', match: '/reconciliation', label: 'Reconciliation', iconName: 'git-compare' },
  { hash: '#/closure', match: '/closure', label: 'Closure', iconName: 'flag' },
  { hash: '#/reports', match: '/reports', label: 'Reports', iconName: 'bar-chart-2' },
  { hash: '#/stakeholders', match: '/stakeholders', label: 'Stakeholders', iconName: 'megaphone' },
  { hash: '#/handover', match: '/handover', label: 'Handover', iconName: 'clipboard-check' },
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
 * thread solid under heavy re-rendering (typing, sorting, drawers, the map).
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

function navHtml() {
  const path = currentPath();
  const direction = getDirection();
  return NAV_ITEMS.filter((item) => !item.departureOnly || direction === 'departure').map((item) => {
    const isCurrent = item.match === '/' ? path === '/' : path.startsWith(item.match);
    return `<a class="nav-item" href="${item.hash}" ${isCurrent ? 'aria-current="page"' : ''}>
      ${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>
    </a>`;
  }).join('');
}

function mountShell() {
  if (shellMounted) { updateNavHighlight(); return; }
  shellMounted = true;
  const session = getSession();
  const direction = getDirection();
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="app-shell">
      <nav class="sidebar" aria-label="Primary">
        <div class="brand">
          <span class="brand-name">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <div class="stack gap-1" id="nav-list">${navHtml()}</div>
      </nav>
      <header class="topbar">
        <div class="row gap-3 wrap">
          <div class="segmented" role="group" aria-label="Workflow direction" id="direction-switch">
            <button type="button" data-dir="departure" aria-selected="${direction === 'departure'}">Departure</button>
            <button type="button" data-dir="arrival" aria-selected="${direction === 'arrival'}">Arrival</button>
          </div>
          <select aria-label="Jump to a flight" id="flight-jump" style="min-height:36px;max-width:180px">
            <option value="">Jump to flight…</option>
          </select>
        </div>
        <div class="row gap-3">
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost btn-icon" id="bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              ${icon('bell', 20)}<span class="bell-badge visually-hidden" id="bell-badge-count"></span>
            </button>
          </div>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost" id="profile-btn" aria-haspopup="true" aria-expanded="false">
              ${icon('user-circle', 20)}<span class="fs-sm">${esc(session?.name || 'Operations Manager')}</span>
            </button>
          </div>
        </div>
      </header>
      <main id="app" tabindex="-1"></main>
    </div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
  renderIcons();
  wireShellInteractions();
  loadFlightJump();
  refreshBellBadge();
}

function updateNavHighlight() {
  const list = document.getElementById('nav-list');
  if (list) { list.innerHTML = navHtml(); renderIcons(); }
}

async function loadFlightJump() {
  try {
    const store = getStore();
    const sel = document.getElementById('flight-jump');
    if (!sel) return;
    const direction = getDirection();
    const flights = store.flights.filter((f) => f.direction === direction && !f.closed);
    sel.innerHTML = `<option value="">Jump to flight…</option>` + flights.map((f) => `<option value="${esc(f.id)}">${esc(f.code)}</option>`).join('');
  } catch (e) { /* ignore */ }
}

async function refreshBellBadge() {
  try {
    const notifications = await api.getNotifications();
    const unread = notifications.filter((n) => n.unread);
    const critical = unread.filter((n) => n.critical);
    const badge = document.getElementById('bell-badge-count');
    if (badge) {
      if (unread.length > 0) {
        badge.textContent = String(unread.length);
        badge.classList.remove('visually-hidden');
        badge.classList.toggle('pulse', critical.length > 0);
      } else badge.classList.add('visually-hidden');
    }
  } catch (e) { /* ignore badge errors */ }
}

function closeAllDropdowns() {
  document.querySelectorAll('.bell-dropdown').forEach((el) => el.remove());
  document.querySelectorAll('#bell-btn,#profile-btn').forEach((el) => el.setAttribute('aria-expanded', 'false'));
}

async function openBellDropdown() {
  closeAllDropdowns();
  const wrap = document.getElementById('bell-btn').parentElement;
  document.getElementById('bell-btn').setAttribute('aria-expanded', 'true');
  const dd = document.createElement('div');
  dd.className = 'bell-dropdown';
  dd.innerHTML = `<div class="skeleton skeleton-row" style="margin:var(--s4)"></div>`;
  wrap.appendChild(dd);
  try {
    const notifications = await api.getNotifications();
    if (!notifications.length) {
      dd.innerHTML = `<div class="bell-item"><span class="muted fs-sm">No notifications.</span></div>`;
      return;
    }
    dd.innerHTML = `
      <div class="row" style="justify-content:space-between;padding:var(--s3) var(--s4);border-bottom:1px solid var(--border)">
        <strong class="fs-sm">Notifications</strong>
        <button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px" data-act="mark-all">Mark all read</button>
      </div>
      ${notifications.map((n) => `
        <a class="bell-item ${n.unread ? 'unread' : ''}" href="${esc(n.link)}" data-notif-id="${esc(n.id)}">
          ${n.critical ? icon('alert-triangle', 16) : icon('info', 16)}
          <span style="flex:1">
            <strong class="fs-sm">${esc(n.title)}</strong>
            <div class="fs-xs muted">${esc(n.body)}</div>
            <div class="fs-xs muted" title="${esc(n.time)}">${fmtRelative(n.time)}</div>
          </span>
        </a>`).join('')}
    `;
    renderIcons();
    dd.querySelector('[data-act="mark-all"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await api.markRead('all');
      closeAllDropdowns();
      refreshBellBadge();
    });
    dd.querySelectorAll('[data-notif-id]').forEach((a) => a.addEventListener('click', async () => {
      await api.markRead(a.dataset.notifId);
      refreshBellBadge();
    }));
  } catch (e) {
    dd.innerHTML = `<div class="bell-item"><span class="muted fs-sm">Couldn't load notifications.</span></div>`;
  }
}

function openProfileDropdown() {
  closeAllDropdowns();
  const wrap = document.getElementById('profile-btn').parentElement;
  document.getElementById('profile-btn').setAttribute('aria-expanded', 'true');
  const dd = document.createElement('div');
  dd.className = 'bell-dropdown';
  dd.innerHTML = `
    <button type="button" class="bell-item" data-act="demo-exception">${icon('alert-triangle', 16)} Inject random exception</button>
    <button type="button" class="bell-item" data-act="demo-delay">${icon('truck', 16)} Delay a truck</button>
    <button type="button" class="bell-item" data-act="demo-cutoff">${icon('timer', 16)} Push a flight into cut-off risk</button>
    <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  wrap.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'logout') {
      closeAllDropdowns();
      api.logout();
      window.location.href = '../index.html';
      return;
    }
    if (act === 'demo-exception') { await api.demoInjectException(); toast('A random exception was injected.', 'info'); refreshBellBadge(); }
    if (act === 'demo-delay') { await api.demoDelayTruck(); toast('A truck was marked delayed.', 'info'); }
    if (act === 'demo-cutoff') { await api.demoPushCutoffRisk(); toast('A flight was pushed into cut-off risk.', 'info'); }
    if (act === 'demo-reset') {
      api.demoReset();
      toast('Demo data reset to the original seed.', 'success');
      closeAllDropdowns();
      navigate('#/');
      return;
    }
    closeAllDropdowns();
    const current = getCurrent();
    if (current && current.refresh) current.refresh();
  });
}

function wireShellInteractions() {
  document.getElementById('bell-btn')?.addEventListener('click', (e) => { e.stopPropagation(); openBellDropdown(); });
  document.getElementById('profile-btn')?.addEventListener('click', (e) => { e.stopPropagation(); openProfileDropdown(); });
  document.getElementById('direction-switch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dir]');
    if (!btn) return;
    const dir = btn.dataset.dir;
    if (dir === getDirection()) return;
    setDirection(dir);
    document.querySelectorAll('#direction-switch [data-dir]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dir === dir)));
    updateNavHighlight();
    loadFlightJump();
    if (dir === 'arrival' && currentPath() === '/cutoffs') {
      toast('Cut-off monitoring applies to departures only.', 'info');
      navigate('#/');
      return;
    }
    const current = getCurrent();
    if (current && current.refresh) current.refresh();
  });
  document.getElementById('flight-jump')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    navigate(`#/reconciliation/${id}`);
    e.target.value = '';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-dropdown') && !e.target.closest('#bell-btn') && !e.target.closest('#profile-btn')) closeAllDropdowns();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDropdowns(); });
}

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
  route('/', wrapView(dashboardView));
  route('/bags', wrapView(bagsView));
  route('/exceptions', wrapView(exceptionsView));
  route('/exceptions/:id', wrapView(exceptionsView));
  route('/trucks', wrapView(trucksView));
  route('/cutoffs', wrapView(cutoffsView));
  route('/reconciliation', wrapView(reconciliationView));
  route('/reconciliation/:flightId', wrapView(reconciliationView));
  route('/closure', wrapView(closureView));
  route('/closure/:flightId', wrapView(closureView));
  route('/reports', wrapView(reportsView));
  route('/stakeholders', wrapView(stakeholdersView));
  route('/handover', wrapView(handoverView));

  setNotFound((app) => {
    mountShell();
    app.innerHTML = `
      <div class="state-block">
        <h1 class="fs-xl">404 — Page not found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a class="btn btn-primary" href="#/">Back to dashboard</a>
      </div>`;
  });

  setGuard((path) => {
    if (path !== '/login' && !isAuthed()) return '#/login';
    if (path === '/login' && isAuthed()) return '#/';
    if (path === '/cutoffs' && getDirection() === 'arrival') return '#/';
    return true;
  });
}

function startPolling() {
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const current = getCurrent();
    if (current && current.poll) current.poll();
    if (shellMounted) refreshBellBadge();
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
