/**
 * App bootstrap: shell chrome (sidebar + topbar + Departure|Arrival focus
 * switch), auth guard, router wiring, polling, global listeners.
 */
import { isAuthed, getSession, isDemoMode, setDemoMode, getFocus, setFocus } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as dashboardView from './views/dashboard.js';
import * as depIncomingView from './views/dep-incoming.js';
import * as depGateView from './views/dep-gate.js';
import * as depReceivingView from './views/dep-receiving.js';
import * as depAirlineView from './views/dep-airline.js';
import * as arrFlightsView from './views/arr-flights.js';
import * as arrReceivingView from './views/arr-receiving.js';
import * as arrSecurityView from './views/arr-security.js';
import * as arrLoadingView from './views/arr-loading.js';
import * as exceptionsView from './views/exceptions.js';
import * as handoverView from './views/handover.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_GROUPS = [
  { group: null, items: [{ hash: '#/', match: '/', label: 'Dashboard', iconName: 'layout-dashboard' }] },
  {
    group: 'departure',
    items: [
      { hash: '#/dep/incoming', match: '/dep/incoming', label: 'Incoming trucks', iconName: 'truck' },
      { hash: '#/dep/gate', match: '/dep/gate', label: 'Gate & holds', iconName: 'shield-alert' },
      { hash: '#/dep/airline', match: '/dep/airline', label: 'Airline handover', iconName: 'plane-takeoff' },
    ],
  },
  {
    group: 'arrival',
    items: [
      { hash: '#/arr/flights', match: '/arr/flights', label: 'Arrival flights', iconName: 'plane-landing' },
      { hash: '#/arr/security', match: '/arr/security', label: 'Security check', iconName: 'scan-search' },
      { hash: '#/arr/loading', match: '/arr/loading', label: 'Truck loading', iconName: 'package-check' },
    ],
  },
  {
    group: null,
    items: [
      { hash: '#/exceptions', match: '/exceptions', label: 'Exceptions', iconName: 'alert-triangle' },
      { hash: '#/handover', match: '/handover', label: 'Handover', iconName: 'clipboard-check' },
    ],
  },
];

let shellMounted = false;
let iconObserver = null;
let iconRenderScheduled = false;
let shiftTimerInterval = null;

function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

/**
 * Renders any pending `data-lucide` placeholders. Disconnects the mutation
 * observer first so lucide's own DOM replacement never re-triggers itself —
 * without this, observing document.body for every mutation while a library
 * that mutates the DOM in response is a feedback loop that can pin the main
 * thread solid under heavy re-rendering.
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
  stopShiftTimer();
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="bare-root"><main id="app" tabindex="-1"></main></div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
}

function navHtml() {
  const path = currentPath();
  const focus = getFocus();
  return NAV_GROUPS.filter((g) => !g.group || g.group === focus || focus === 'both').map((g) => g.items.map((item) => {
    const isCurrent = item.match === '/' ? path === '/' : path.startsWith(item.match);
    return `<a class="nav-item" href="${item.hash}" ${isCurrent ? 'aria-current="page"' : ''}>
      ${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>
    </a>`;
  }).join('')).join('');
}

function formatElapsed(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function startShiftTimer() {
  const session = getSession();
  const el = document.getElementById('shift-timer');
  if (!el || !session?.shiftStartedAt) return;
  const tick = () => { el.textContent = formatElapsed(Date.now() - new Date(session.shiftStartedAt).getTime()); };
  tick();
  shiftTimerInterval = setInterval(tick, 30000);
}

function stopShiftTimer() {
  if (shiftTimerInterval) { clearInterval(shiftTimerInterval); shiftTimerInterval = null; }
}

function mountShell() {
  document.body.setAttribute('data-focus', getFocus());
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
          <span class="gate-badge">${esc(session?.airport || '')}</span>
          <div class="focus-switch-wrap">
            <div class="segmented" role="tablist" aria-label="Focus">
              <button type="button" role="tab" data-focus-btn="departure" aria-selected="${getFocus() === 'departure'}">Departure</button>
              <button type="button" role="tab" data-focus-btn="arrival" aria-selected="${getFocus() === 'arrival'}">Arrival</button>
              <button type="button" role="tab" data-focus-btn="both" aria-selected="${getFocus() === 'both'}">Both</button>
            </div>
          </div>
          <span class="fs-sm muted">${esc(session?.name || '')}</span>
          <span class="row gap-1 fs-sm muted">${icon('clock', 14)} <span id="shift-timer" class="shift-timer">00:00</span></span>
        </div>
        <div class="row gap-3">
          <a class="btn btn-secondary" href="#/handover">${icon('log-out', 16)} End shift</a>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost btn-icon" id="bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              ${icon('bell', 20)}<span class="bell-badge visually-hidden" id="bell-badge-count"></span>
            </button>
          </div>
          <div class="bell-wrap">
            <button type="button" class="btn btn-ghost btn-icon" id="profile-btn" aria-label="Menu" aria-haspopup="true" aria-expanded="false">
              ${icon('more-vertical', 20)}
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
  startShiftTimer();
  refreshBellBadge();
}

function updateNavHighlight() {
  const list = document.getElementById('nav-list');
  if (list) { list.innerHTML = navHtml(); renderIcons(); }
  document.querySelectorAll('[data-focus-btn]').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.focusBtn === getFocus())));
}

function onFocusSwitch(next) {
  if (next === getFocus()) return;
  setFocus(next);
  document.body.setAttribute('data-focus', next);
  updateNavHighlight();
  const path = currentPath();
  const belongsToOtherSide = (next === 'departure' && path.startsWith('/arr/')) || (next === 'arrival' && path.startsWith('/dep/'));
  if (belongsToOtherSide) navigate('#/');
  else { const current = getCurrent(); if (current?.refresh) current.refresh(); }
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
  const demoOn = isDemoMode();
  dd.innerHTML = `
    <button type="button" class="bell-item" data-act="toggle-demo">${icon('flask-conical', 16)} <span style="flex:1">Demo mode</span> ${demoOn ? '<span class="chip chip-green">On</span>' : ''}</button>
    ${demoOn ? `
      <button type="button" class="bell-item" data-act="demo-send-truck">${icon('truck', 16)} Send a departure truck now</button>
      <button type="button" class="bell-item" data-act="demo-unload-all">${icon('package-check', 16)} Simulate unloading (all)</button>
      <button type="button" class="bell-item" data-act="demo-unload-one">${icon('package-minus', 16)} Simulate unloading (all but one)</button>
      <button type="button" class="bell-item" data-act="demo-airline-reject">${icon('x-circle', 16)} Airline rejects next submit</button>
      <button type="button" class="bell-item" data-act="demo-new-flight">${icon('plane-landing', 16)} Create arrival flight landing in 10 min</button>
      <button type="button" class="bell-item" data-act="demo-carousel-all">${icon('rotate-cw', 16)} Simulate carousel (all)</button>
      <button type="button" class="bell-item" data-act="demo-carousel-partial">${icon('rotate-ccw', 16)} Simulate carousel (all but one + unidentified)</button>
      <button type="button" class="bell-item" data-act="demo-driver-ready">${icon('check-check', 16)} Simulate driver count + seal</button>
    ` : ''}
    <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  wrap.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'logout') { closeAllDropdowns(); api.logout(); window.location.href = '../index.html'; return; }
    if (act === 'toggle-demo') {
      setDemoMode(!demoOn);
      toast(`Demo mode ${!demoOn ? 'on' : 'off'}.`, 'info');
      closeAllDropdowns();
      const current = getCurrent();
      if (current && current.refresh) current.refresh();
      return;
    }
    const current = getCurrent();
    try {
      if (act === 'demo-send-truck') { await api.demoSendDepartureTruckNow(); toast('A truck has arrived at the gate.', 'success'); }
      if (act === 'demo-unload-all') { await api.demoSimulateUnloading(current?.activeTripId?.() || null, false); toast('Unloading simulated.', 'info'); }
      if (act === 'demo-unload-one') { await api.demoSimulateUnloading(current?.activeTripId?.() || null, true); toast('Unloaded all but one bag.', 'info'); }
      if (act === 'demo-airline-reject') { await api.demoAirlineRejectsNext(); toast('The next airline submission will be rejected.', 'info'); }
      if (act === 'demo-new-flight') { const r = await api.demoCreateArrivalFlightLanding10Min(); toast(`${r.flightCode} created, landing in 10 minutes.`, 'success'); }
      if (act === 'demo-carousel-all') { await api.demoSimulateCarousel(current?.activeFlightCode?.() || 'SV 819', 'all'); toast('Carousel simulated.', 'info'); }
      if (act === 'demo-carousel-partial') { await api.demoSimulateCarousel(current?.activeFlightCode?.() || 'SV 819', 'all-but-one-plus-unidentified'); toast('Carousel simulated — one bag missing, one unidentified.', 'info'); }
      if (act === 'demo-driver-ready') { await api.simulateDriverCountSeal(current?.activeTripId?.() || null); toast('Driver count and seal confirmed.', 'success'); }
    } catch (err) { toast(err.message, 'error'); }
    if (act === 'demo-reset') {
      api.demoReset();
      toast('Demo data reset to the original seed.', 'success');
      closeAllDropdowns();
      navigate('#/');
      return;
    }
    closeAllDropdowns();
    if (current && current.refresh) current.refresh();
  });
}

function wireShellInteractions() {
  document.getElementById('bell-btn')?.addEventListener('click', (e) => { e.stopPropagation(); openBellDropdown(); });
  document.getElementById('profile-btn')?.addEventListener('click', (e) => { e.stopPropagation(); openProfileDropdown(); });
  document.querySelectorAll('[data-focus-btn]').forEach((btn) => btn.addEventListener('click', () => onFocusSwitch(btn.dataset.focusBtn)));
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
  route('/dep/incoming', wrapView(depIncomingView));
  route('/dep/gate', wrapView(depGateView));
  route('/dep/receiving/:id', wrapView(depReceivingView));
  route('/dep/airline', wrapView(depAirlineView));
  route('/dep/airline/:batchId', wrapView(depAirlineView));
  route('/arr/flights', wrapView(arrFlightsView));
  route('/arr/flights/:id', wrapView(arrFlightsView));
  route('/arr/receiving/:id', wrapView(arrReceivingView));
  route('/arr/security', wrapView(arrSecurityView));
  route('/arr/loading', wrapView(arrLoadingView));
  route('/arr/loading/:tripId', wrapView(arrLoadingView));
  route('/exceptions', wrapView(exceptionsView));
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
