/**
 * App bootstrap: shell chrome (top bar + bottom tab bar), auth guard,
 * router wiring, polling, global listeners.
 */
import { isAuthed, isDemoMode, setDemoMode, getSession } from './store.js';
import * as api from './api.js';
import { route, setGuard, setNotFound, startRouter, navigate, getCurrent } from './router.js';
import { icon, toast, esc } from './ui.js';

import * as loginView from './views/login.js';
import * as homeView from './views/home.js';
import * as bookView from './views/book.js';
import * as bookingView from './views/booking.js';
import * as trackView from './views/track.js';
import * as bagView from './views/bag.js';
import * as receiptView from './views/receipt.js';
import * as supportView from './views/support.js';
import * as arrivalView from './views/arrival.js';
import * as reportMissingView from './views/report-missing.js';
import * as resolutionView from './views/resolution.js';
import * as rateView from './views/rate.js';
import * as completeView from './views/complete.js';
import * as notificationsView from './views/notifications.js';
import * as profileView from './views/profile.js';

window.RABEL_DEBUG = window.RABEL_DEBUG || false;

const TAB_ITEMS = [
  { hash: '#/', prefixes: ['/'], label: 'Home', iconName: 'home' },
  { hash: '#/book', prefixes: ['/book', '/booking'], label: 'Book', iconName: 'calendar-plus' },
  { hash: '#/track', prefixes: ['/track', '/bag', '/receipt', '/arrival'], label: 'Track', iconName: 'package-search' },
  { hash: '#/support', prefixes: ['/support', '/ticket'], label: 'Support', iconName: 'life-buoy' },
  { hash: '#/profile', prefixes: ['/profile', '/notifications'], label: 'Profile', iconName: 'user' },
];

let shellMounted = false;
let iconObserver = null;
let iconRenderScheduled = false;

function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

function isTabActive(item, path) {
  return item.prefixes.some((p) => (p === '/' ? path === '/' : path.startsWith(p)));
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
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="bare-root"><main id="app" tabindex="-1"></main></div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
}

function tabBarHtml() {
  const path = currentPath();
  return TAB_ITEMS.map((item) => `
    <a class="tab-link" href="${item.hash}" ${isTabActive(item, path) ? 'aria-current="page"' : ''}>
      ${icon(item.iconName, 22)}<span>${esc(item.label)}</span>
    </a>`).join('');
}

function mountShell() {
  if (shellMounted) { updateTabHighlight(); return; }
  shellMounted = true;
  document.body.innerHTML = `
    <a href="#main" class="skip-link">Skip to main content</a>
    <div id="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-name">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <div class="row gap-2">
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
      <nav class="tabbar" id="tabbar" aria-label="Primary">${tabBarHtml()}</nav>
    </div>
    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
  `;
  renderIcons();
  wireShellInteractions();
  refreshBellBadge();
}

function updateTabHighlight() {
  const bar = document.getElementById('tabbar');
  if (bar) { bar.innerHTML = tabBarHtml(); renderIcons(); }
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
      ${notifications.slice(0, 6).map((n) => `
        <a class="bell-item ${n.unread ? 'unread' : ''}" href="${esc(n.link)}" data-notif-id="${esc(n.id)}">
          <span style="flex:1">
            <strong class="fs-sm">${esc(n.title)}</strong>
            <div class="fs-xs muted">${esc(n.body)}</div>
          </span>
        </a>`).join('')}
      <a class="bell-item" href="#/notifications" style="justify-content:center"><strong class="fs-sm">See all</strong></a>
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
      <button type="button" class="bell-item" data-act="demo-checkin">${icon('qr-code', 16)} Simulate check-in</button>
      <button type="button" class="bell-item" data-act="demo-advance-one">${icon('arrow-right', 16)} Advance bag →</button>
      <button type="button" class="bell-item" data-act="demo-advance-all">${icon('fast-forward', 16)} Advance all →</button>
      <button type="button" class="bell-item" data-act="demo-raise">${icon('alert-triangle', 16)} Raise exception</button>
      <button type="button" class="bell-item" data-act="demo-resolve">${icon('check-circle', 16)} Resolve exception</button>
      <button type="button" class="bell-item" data-act="demo-reply">${icon('message-circle', 16)} Reply as support</button>
    ` : ''}
    <button type="button" class="bell-item" data-act="demo-reset">${icon('rotate-ccw', 16)} Reset demo data</button>
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
    const current = getCurrent();
    try {
      if (act === 'demo-checkin') { await api.demoSimulateCheckIn(); toast('Checked in — tags and a receipt were created.', 'success'); }
      if (act === 'demo-advance-one') { await api.demoAdvanceBag(current?.activeBagId?.() || null); toast('Bag advanced to its next status.', 'info'); }
      if (act === 'demo-advance-all') { await api.demoAdvanceAll(); toast('Bags advanced.', 'info'); }
      if (act === 'demo-raise') { await api.demoRaiseException(current?.activeBagId?.() || null); toast('An exception was raised on one of your bags.', 'info'); }
      if (act === 'demo-resolve') { await api.demoResolveException(null); toast('An open exception was resolved.', 'success'); }
      if (act === 'demo-reply') { await api.demoReplyAsSupport(current?.activeTicketId?.() || null); toast('Support replied on your ticket.', 'info'); }
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
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-dropdown') && !e.target.closest('#bell-btn') && !e.target.closest('#profile-btn')) closeAllDropdowns();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDropdowns(); });
}

function wrapView(view) {
  return (params, app) => {
    mountShell();
    updateTabHighlight();
    const result = view.render(params, document.getElementById('app'));
    return result || { destroy: view.destroy };
  };
}

function registerRoutes() {
  route('/login', (params, app) => {
    mountBare();
    return loginView.render(params, document.getElementById('app')) || { destroy: loginView.destroy };
  });
  route('/', wrapView(homeView));
  route('/book', wrapView(bookView));
  route('/booking/:id', wrapView(bookingView));
  route('/track', wrapView(trackView));
  route('/bag/:id', wrapView(bagView));
  route('/receipt/:id', wrapView(receiptView));
  route('/support', wrapView(supportView));
  route('/support/new', wrapView(supportView));
  route('/ticket/:id', wrapView(supportView));
  route('/arrival', wrapView(arrivalView));
  route('/arrival/report-missing', wrapView(reportMissingView));
  route('/arrival/resolution', wrapView(resolutionView));
  route('/arrival/rate', wrapView(rateView));
  route('/arrival/complete', wrapView(completeView));
  route('/notifications', wrapView(notificationsView));
  route('/profile', wrapView(profileView));

  setNotFound((app) => {
    mountShell();
    app.innerHTML = `
      <div class="state-block">
        <h1 class="fs-xl">404 — Page not found</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a class="btn btn-primary" href="#/">Back to home</a>
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
