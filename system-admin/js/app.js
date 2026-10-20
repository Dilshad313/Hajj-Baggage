/**
 * App bootstrap: shell chrome, auth guard, router wiring, polling, global listeners.
 */
import { isAuthed, getSession, getStore } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, fmtRelative, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as dashboardView from './views/dashboard.js';
import * as usersView from './views/users.js';
import * as rolesView from './views/roles.js';
import * as configView from './views/config.js';
import * as healthView from './views/health.js';
import * as errorsView from './views/errors.js';
import * as auditView from './views/audit.js';
import * as reportsView from './views/reports.js';
import * as exportView from './views/export.js';
import * as masterdataView from './views/masterdata.js';
import * as handoverView from './views/handover.js';
import * as notificationsView from './views/notifications.js';
import * as profileView from './views/profile.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_ITEMS = [
  { hash: '#/', match: '/', label: 'Dashboard', iconName: 'layout-dashboard' },
  { hash: '#/users', match: '/users', label: 'Users', iconName: 'users' },
  { hash: '#/roles', match: '/roles', label: 'Roles & permissions', iconName: 'shield-check' },
  { hash: '#/config', match: '/config', label: 'System configuration', iconName: 'settings' },
  { hash: '#/health', match: '/health', label: 'System health', iconName: 'activity' },
  { hash: '#/errors', match: '/errors', label: 'Error logs', iconName: 'alert-triangle' },
  { hash: '#/audit', match: '/audit', label: 'Audit logs', iconName: 'scroll-text' },
  { hash: '#/reports', match: '/reports', label: 'Reports', iconName: 'bar-chart-2' },
  { hash: '#/export', match: '/export', label: 'Export data', iconName: 'download' },
  { hash: '#/masterdata', match: '/masterdata', label: 'Master data', iconName: 'database' },
  { hash: '#/handover', match: '/handover', label: 'Admin handover', iconName: 'clipboard-check' },
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
 * thread solid under heavy re-rendering (typing, sorting, drawers).
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
    return `<a class="nav-item" href="${item.hash}" ${isCurrent ? 'aria-current="page"' : ''}>
      ${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>
    </a>`;
  }).join('');
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
        <div class="row gap-3">
          <span class="badge-env">DEMO</span>
          <span class="fs-sm muted">System Admin Console</span>
        </div>
        <div class="row gap-3">
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost btn-icon" id="bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              ${icon('bell', 20)}<span class="bell-badge visually-hidden" id="bell-badge-count"></span>
            </button>
          </div>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost" id="profile-btn" aria-haspopup="true" aria-expanded="false">
              ${icon('user-circle', 20)}<span class="fs-sm">${esc(session?.name || 'Admin')}</span>
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
  refreshBellBadge();
}

function updateNavHighlight() {
  const list = document.getElementById('nav-list');
  if (list) { list.innerHTML = navHtml(); renderIcons(); }
}

async function refreshBellBadge() {
  try {
    const notifications = await api.getNotifications();
    const count = notifications.filter((n) => n.unread).length;
    const badge = document.getElementById('bell-badge-count');
    if (badge) {
      if (count > 0) { badge.textContent = String(count); badge.classList.remove('visually-hidden'); }
      else badge.classList.add('visually-hidden');
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
          <span style="flex:1">
            <strong class="fs-sm">${esc(n.title)}</strong>
            <div class="fs-xs muted">${esc(n.body)}</div>
            <div class="fs-xs muted" title="${esc(n.time)}">${fmtRelative(n.time)}</div>
          </span>
        </a>`).join('')}
    `;
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
    <a class="bell-item" href="#/profile" data-act="profile">${icon('user', 16)} My profile</a>
    <button type="button" class="bell-item" data-act="demo-degrade">${icon('activity', 16)} Degrade a service</button>
    <button type="button" class="bell-item" data-act="demo-burst">${icon('alert-triangle', 16)} Generate error burst</button>
    <button type="button" class="bell-item" data-act="demo-expire">${icon('key', 16)} Expire Nusuk key</button>
    <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  wrap.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'profile') { closeAllDropdowns(); return; }
    e.preventDefault();
    if (act === 'logout') {
      closeAllDropdowns();
      api.logout();
      navigate('#/login');
      return;
    }
    if (act === 'demo-degrade') { await api.demoDegradeService(); toast('A service was degraded for the demo.', 'info'); }
    if (act === 'demo-burst') { await api.demoGenerateErrorBurst(); toast('Simulated an error burst.', 'info'); }
    if (act === 'demo-expire') { await api.demoExpireNusukKey(); toast('Nusuk API key marked as expired.', 'info'); refreshBellBadge(); }
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
  route('/users', wrapView(usersView));
  route('/roles', wrapView(rolesView));
  route('/config', wrapView(configView));
  route('/health', wrapView(healthView));
  route('/errors', wrapView(errorsView));
  route('/errors/:id', wrapView(errorsView));
  route('/audit', wrapView(auditView));
  route('/reports', wrapView(reportsView));
  route('/export', wrapView(exportView));
  route('/masterdata', wrapView(masterdataView));
  route('/handover', wrapView(handoverView));
  route('/notifications', wrapView(notificationsView));
  route('/profile', wrapView(profileView));

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
