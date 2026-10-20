/**
 * App bootstrap: shell chrome (bottom tab bar / sidebar), auth guard, router
 * wiring, polling, global listeners.
 */
import { isAuthed, getSession, isDemoMode, setDemoMode } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, esc } from './ui.js';
import { routeForTrip } from './trip-nav.js';

import * as loginView from './views/login.js';
import * as tripsView from './views/trips.js';
import * as tripOverviewView from './views/trip-overview.js';
import * as vehicleView from './views/vehicle.js';
import * as pretripView from './views/pretrip.js';
import * as pickupView from './views/pickup.js';
import * as countView from './views/count.js';
import * as sealView from './views/seal.js';
import * as mapView from './views/map.js';
import * as arriveView from './views/arrive.js';
import * as securityView from './views/security.js';
import * as offloadView from './views/offload.js';
import * as handoverView from './views/handover.js';
import * as completeView from './views/complete.js';
import * as alertsView from './views/alerts.js';
import * as profileView from './views/profile.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const NAV_ITEMS = [
  { id: 'trips', hash: '#/', match: '/', label: 'Trips', iconName: 'list-checks' },
  { id: 'current', label: 'Current trip', iconName: 'navigation' },
  { id: 'map', hash: '#/map', match: '/map', label: 'Map', iconName: 'map' },
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
 * thread solid under heavy re-rendering (the GPS/offload/count screens poll
 * and re-render often).
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
  const isCurrent = item.hash ? (item.match === '/' ? path === '/' : path.startsWith(item.match)) : path.startsWith('/trip/');
  const attrs = `class="nav-item" ${isCurrent ? 'aria-current="page"' : ''}`;
  const inner = `${icon(item.iconName, 20)}<span class="nav-label-text">${esc(item.label)}</span>`;
  if (item.hash) return `<a href="${item.hash}" ${attrs}>${inner}</a>`;
  return `<button type="button" data-nav="${item.id}" ${attrs}>${inner}</button>`;
}

function navListHtml() {
  const path = currentPath();
  return NAV_ITEMS.map((item) => navItemHtml(item, path)).join('');
}

async function goToCurrentTrip() {
  try {
    const trip = await api.getActiveTrip();
    if (trip) navigate(routeForTrip(trip));
    else toast('No active trip right now.', 'info');
  } catch (e) {
    toast('Could not load your trips.', 'error');
  }
}

function wireNav(root) {
  root.querySelectorAll('[data-nav="current"]').forEach((btn) => btn.addEventListener('click', goToCurrentTrip));
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
          ${icon('settings', 18)} <span class="fs-sm">${esc(session?.name || 'Driver')}</span>
        </button>
      </nav>
      <div id="main-col">
        <header class="topbar">
          <span class="row gap-2"><span class="badge-env">DEMO</span><span class="fs-sm muted">${esc(session?.name || '')}</span></span>
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

function statusOnBadge() { return `<span class="chip chip-green" style="margin-inline-start:auto">On</span>`; }

async function openProfileMenu(anchorBtn) {
  closeProfileMenu();
  anchorBtn.setAttribute('aria-expanded', 'true');
  const dd = document.createElement('div');
  dd.className = 'bell-dropdown';
  dd.style.position = 'absolute';
  const rect = anchorBtn.getBoundingClientRect();
  dd.style.top = `${rect.bottom + window.scrollY + 8}px`;
  dd.style.insetInlineEnd = `${Math.max(8, window.innerWidth - rect.right)}px`;
  const demoOn = isDemoMode();
  let activeTrip = null;
  try { activeTrip = await api.getActiveTrip(); } catch (e) { /* ignore */ }
  dd.innerHTML = `
    <button type="button" class="bell-item" data-act="end-shift">${icon('log-out', 16)} End shift</button>
    <button type="button" class="bell-item" data-act="toggle-demo">
      ${icon('flask-conical', 16)} <span style="flex:1">Demo mode</span> ${demoOn ? statusOnBadge() : ''}
    </button>
    ${demoOn ? `
      <button type="button" class="bell-item" data-act="demo-assign-dep">${icon('plus-circle', 16)} Assign new departure trip</button>
      <button type="button" class="bell-item" data-act="demo-assign-arr">${icon('plus-circle', 16)} Assign new arrival trip</button>
      ${activeTrip ? `
        <button type="button" class="bell-item" data-act="demo-ff-gps">${icon('fast-forward', 16)} Fast-forward GPS (90%)</button>
        <button type="button" class="bell-item" data-act="demo-traffic">${icon('triangle-alert', 16)} Simulate traffic +25 min</button>
        <button type="button" class="bell-item" data-act="demo-release-hold">${icon('shield-check', 16)} Release security hold</button>
        <button type="button" class="bell-item" data-act="demo-sealed">${icon('lock', 16)} Warehouse sealed this trip</button>
        <button type="button" class="bell-item" data-act="demo-unload-all">${icon('package-check', 16)} Simulate unloading (all)</button>
        <button type="button" class="bell-item" data-act="demo-unload-one">${icon('package-minus', 16)} Simulate unloading (all but one)</button>
        <button type="button" class="bell-item" data-act="demo-receiver">${icon('user-check', 16)} Simulate receiver confirmation</button>
      ` : ''}
      <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
    ` : ''}
    <button type="button" class="bell-item" style="color:var(--danger)" data-act="logout">${icon('log-out', 16)} Log out</button>
  `;
  document.body.appendChild(dd);
  renderIcons();
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const refreshCurrent = () => { const c = getCurrent(); if (c && c.refresh) c.refresh(); };
    if (act === 'logout') { closeProfileMenu(); api.logout(); navigate('#/login'); return; }
    if (act === 'end-shift') {
      closeProfileMenu();
      try { await api.endShift(); toast('Shift ended. See you next trip.', 'success'); navigate('#/login'); api.logout(); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'toggle-demo') {
      setDemoMode(!demoOn);
      toast(`Demo mode ${!demoOn ? 'on' : 'off'}.`, 'info');
      closeProfileMenu();
      refreshCurrent();
      return;
    }
    if (act === 'demo-assign-dep') { const r = await api.demoAssignTrip('Departure'); toast('A new departure trip was assigned.', 'success'); closeProfileMenu(); navigate(`#/trip/${r.tripId}`); return; }
    if (act === 'demo-assign-arr') { const r = await api.demoAssignTrip('Arrival'); toast('A new arrival trip was assigned.', 'success'); closeProfileMenu(); navigate(`#/trip/${r.tripId}`); return; }
    if (!activeTrip) { closeProfileMenu(); return; }
    try {
      if (act === 'demo-ff-gps') { await api.demoFastForwardGps(activeTrip.id); toast('GPS fast-forwarded to 90%.', 'info'); }
      if (act === 'demo-traffic') { await api.demoSimulateTrafficDelay(activeTrip.id); toast('Traffic delay of 25 min simulated.', 'info'); }
      if (act === 'demo-release-hold') { await api.demoReleaseSecurityHold(activeTrip.id); toast('Security hold released.', 'success'); }
      if (act === 'demo-sealed') { await api.demoDepotSealed(activeTrip.id); toast('Trip marked as sealed by the depot.', 'info'); }
      if (act === 'demo-unload-all') { await api.demoSimulateUnloading(activeTrip.id, 'all'); toast('All bags simulated as unloaded.', 'info'); }
      if (act === 'demo-unload-one') { await api.demoSimulateUnloading(activeTrip.id, 'all-but-one'); toast('All but one bag simulated as unloaded.', 'info'); }
      if (act === 'demo-receiver') { await api.demoSimulateReceiverConfirmation(activeTrip.id); toast('Receiver confirmation simulated.', 'success'); }
    } catch (err) { toast(err.message, 'error'); }
    if (act === 'demo-reset') {
      api.demoReset();
      toast('Demo data reset to the original seed.', 'success');
      closeProfileMenu();
      navigate('#/');
      return;
    }
    closeProfileMenu();
    refreshCurrent();
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
  route('/', wrapView(tripsView));
  route('/trip/:id', wrapView(tripOverviewView));
  route('/trip/:id/vehicle', wrapView(vehicleView));
  route('/trip/:id/pretrip', wrapView(pretripView));
  route('/trip/:id/pickup', wrapView(pickupView));
  route('/trip/:id/count', wrapView(countView));
  route('/trip/:id/seal', wrapView(sealView));
  route('/map', wrapView(mapView));
  route('/trip/:id/arrive', wrapView(arriveView));
  route('/trip/:id/security', wrapView(securityView));
  route('/trip/:id/offload', wrapView(offloadView));
  route('/trip/:id/handover', wrapView(handoverView));
  route('/trip/:id/complete', wrapView(completeView));
  route('/alerts', wrapView(alertsView));
  route('/profile', wrapView(profileView));

  setNotFound((app) => {
    mountShell();
    app.innerHTML = `
      <div class="state-block">
        <h1 class="fs-xl">404 — Page not found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a class="btn btn-primary" href="#/">Back to trips</a>
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
