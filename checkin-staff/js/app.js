/**
 * App bootstrap: shell chrome, auth guard, router wiring, polling, global listeners.
 */
import { isAuthed, getSession, isDemoMode, setDemoMode } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as dashboardView from './views/dashboard.js';
import * as appointmentsView from './views/appointments.js';
import * as checkinView from './views/checkin.js';
import * as loadingView from './views/loading.js';
import * as exceptionsView from './views/exceptions.js';
import * as historyView from './views/history.js';
import * as handoverView from './views/handover.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_ITEMS = [
  { hash: '#/', match: '/', label: 'Dashboard', iconName: 'layout-dashboard' },
  { hash: '#/appointments', match: '/appointments', label: 'Appointments', iconName: 'calendar-clock' },
  { hash: '#/checkin', match: '/checkin', label: 'Check-in', iconName: 'scan-line' },
  { hash: '#/loading', match: '/loading', label: 'Loading', iconName: 'truck' },
  { hash: '#/exceptions', match: '/exceptions', label: 'Exceptions', iconName: 'alert-triangle' },
  { hash: '#/history', match: '/history', label: 'History', iconName: 'history' },
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
 * observer first so lucide's own DOM replacement never re-triggers itself.
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
  return NAV_ITEMS.map((item) => {
    const isCurrent = item.match === '/' ? path === '/' : path.startsWith(item.match);
    return `<a class="nav-item" href="${item.hash}" data-nav-hash="${item.hash}" ${isCurrent ? 'aria-current="page"' : ''}>
      ${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>
    </a>`;
  }).join('');
}

/**
 * Clicking a nav link to the route you're already on fires no `hashchange`
 * event (the hash doesn't change), so a screen stuck mid-flow — e.g. the
 * Check-in counter showing a dead-end result for the last pilgrim — would
 * never reset. Route every sidebar click through `navigate()`, which forces
 * a fresh re-render even when the target hash matches the current one.
 */
function wireNavLinks(root) {
  root?.querySelectorAll('[data-nav-hash]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(a.dataset.navHash);
  }));
}

function fmtElapsed(startIso) {
  if (!startIso) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(startIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
        <div class="stack gap-1" id="nav-list">${navHtml()}</div>
      </nav>
      <header class="topbar">
        <div class="row gap-3 wrap">
          <span class="badge-env">DEMO</span>
          <span class="fs-sm fw-semibold">${esc(session?.centreName || '')}</span>
          <span class="fs-sm muted">Counter ${esc(session?.counterNo || '')}</span>
          <span class="fs-sm muted">${esc(session?.name || '')}</span>
        </div>
        <div class="row gap-3">
          <span class="shift-timer" id="shift-timer">${icon('clock', 16)} ${fmtElapsed(session?.shiftStartedAt)}</span>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost btn-icon" id="bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              ${icon('bell', 20)}<span class="bell-badge visually-hidden" id="bell-badge-count"></span>
            </button>
          </div>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost" id="profile-btn" aria-haspopup="true" aria-expanded="false">
              ${icon('user-circle', 20)}<span class="fs-sm">${esc(session?.name || 'Staff')}</span>
            </button>
          </div>
          <button type="button" class="btn btn-secondary" id="end-shift-btn">${icon('log-out', 16)} End shift</button>
        </div>
      </header>
      <main id="app" tabindex="-1"></main>
    </div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
  renderIcons();
  wireShellInteractions();
  wireNavLinks(document.getElementById('nav-list'));
  refreshBellBadge();
}

function updateNavHighlight() {
  const list = document.getElementById('nav-list');
  if (list) { list.innerHTML = navHtml(); renderIcons(); wireNavLinks(list); }
}

function updateShiftTimer() {
  const el = document.getElementById('shift-timer');
  if (!el) return;
  const session = getSession();
  el.innerHTML = `${icon('clock', 16)} ${fmtElapsed(session?.shiftStartedAt)}`;
  renderIcons();
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
  const demoOn = isDemoMode();
  const dd = document.createElement('div');
  dd.className = 'bell-dropdown';
  dd.innerHTML = `
    <button type="button" class="bell-item" data-act="toggle-demo">
      ${icon('flask-conical', 16)} <span style="flex:1">Demo mode</span> ${demoOn ? '<span class="chip chip-green">On</span>' : ''}
    </button>
    ${demoOn ? `
      <button type="button" class="bell-item" data-act="demo-overweight">${icon('scale', 16)} Force next scale reading overweight</button>
      <button type="button" class="bell-item" data-act="demo-walkin">${icon('user-plus', 16)} Create test booking for today</button>
      <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    ` : ''}
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  wrap.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'logout') { closeAllDropdowns(); api.logout(); navigate('#/login'); return; }
    if (act === 'toggle-demo') {
      setDemoMode(!demoOn);
      toast(`Demo mode ${!demoOn ? 'on' : 'off'}.`, 'info');
      closeAllDropdowns();
      const current = getCurrent();
      if (current && current.refresh) current.refresh();
      return;
    }
    if (act === 'demo-overweight') { await api.demoForceOverweight(); toast('Next scale reading will be forced overweight.', 'info'); }
    if (act === 'demo-walkin') { const r = await api.demoCreateTestBooking(); toast('A test booking was created for today.', 'success'); closeAllDropdowns(); navigate('#/appointments'); return; }
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
  document.getElementById('end-shift-btn')?.addEventListener('click', () => navigate('#/handover'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-dropdown') && !e.target.closest('#bell-btn') && !e.target.closest('#profile-btn')) closeAllDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllDropdowns();
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      const field = document.querySelector('#scan-field-input');
      if (field) { e.preventDefault(); field.focus(); }
    }
  });
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
  route('/appointments', wrapView(appointmentsView));
  route('/checkin', wrapView(checkinView));
  route('/loading', wrapView(loadingView));
  route('/exceptions', wrapView(exceptionsView));
  route('/exceptions/:id', wrapView(exceptionsView));
  route('/history', wrapView(historyView));
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
    return true;
  });
}

function startPolling() {
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const current = getCurrent();
    if (current && current.poll) current.poll();
    if (shellMounted) { refreshBellBadge(); updateShiftTimer(); }
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
