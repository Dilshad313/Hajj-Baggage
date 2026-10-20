import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, esc, icon, toast, openDrawer, fmtWeight,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let tab = 'carts';

export function render(params, app) {
  appEl = app;
  tab = params.tab === 'trucks' ? 'trucks' : 'carts';
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

function pageShell() {
  return `
    <div class="page-header"><div><h1 class="page-title">Loading</h1></div></div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'carts'}" data-tab="carts">Carts</button>
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'trucks'}" data-tab="trucks">Trucks</button>
    </div>
    <div id="loading-body"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => { tab = btn.dataset.tab; load(); }));
  const root = appEl.querySelector('#loading-body');
  root.innerHTML = skeletonBlock(5);
  try {
    if (tab === 'carts') await loadCarts(root);
    else await loadTrucks(root);
  } catch (err) {
    if (!appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

/* ===================== CARTS ===================== */

async function loadCarts(root) {
  const [carts, awaiting] = await Promise.all([api.getCarts(), api.getBagsAwaitingCart()]);
  if (!appEl) return;
  root.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 2fr">
      <div class="card">
        <h2 class="section-title">Bags awaiting cart</h2>
        ${awaiting.length ? `<div class="stack">${awaiting.map((b) => `
          <div class="manifest-row row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
            <span class="mono fs-sm">${esc(b.tagNumber)}</span>
            <span class="fs-xs muted">${esc(b.flightCode)} · ${fmtWeight(b.weightKg)}</span>
          </div>`).join('')}</div>` : emptyState({ message: 'No bags waiting for a cart.' })}
      </div>
      <div>
        <div class="grid grid-cols-2" id="cart-cards"></div>
      </div>
    </div>`;
  renderCartCards(root.querySelector('#cart-cards'), carts);
}

function renderCartCards(root, carts) {
  root.innerHTML = carts.map((c) => `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong class="mono">${esc(c.id)}</strong>${statusChip(c.status)}
      </div>
      <p class="fs-sm muted" style="margin-block-start:4px">${c.bags.length} bags · ${fmtWeight(c.weightKg)}</p>
      <button type="button" class="btn btn-primary btn-block" style="margin-block-start:var(--s4)" data-cart="${esc(c.id)}">
        ${icon('shopping-cart', 16)} ${c.status === 'Open' ? (c.bags.length ? 'Continue loading' : 'Start loading') : c.status === 'Closed' ? 'Reopen cart' : 'Loaded'}
      </button>
    </div>`).join('');
  root.querySelectorAll('[data-cart]').forEach((btn) => btn.addEventListener('click', () => openCartDrawer(btn.dataset.cart)));
}

function openCartDrawer(cartId) {
  let cart = null;
  const drawer = openDrawer({ title: `Load ${cartId}`, bodyHtml: `<div id="cart-drawer-body"></div>` });

  function body() { return drawer.el.querySelector('#cart-drawer-body'); }

  function renderConfirmStep() {
    body().innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Scan the cart QR to begin loading.</p>
      <div id="cart-confirm-scan"></div>`;
    createScanInput(body().querySelector('#cart-confirm-scan'), {
      label: 'Scan the cart QR',
      placeholder: 'Scan or type the cart ID',
      onSubmit: async (code) => {
        cart = await api.confirmCartScan(cartId, code);
        renderLoadStep();
        return { message: `${cartId} ready for loading.` };
      },
    });
  }

  function renderLoadStep() {
    body().innerHTML = `
      <div class="card" style="margin-block-end:var(--s4)">
        <div class="fs-sm muted">Bags in cart</div>
        <div class="fs-xl fw-bold">${cart.bags.length}</div>
      </div>
      <div id="cart-bag-scan"></div>
      <div class="stack" id="cart-bag-list" style="margin-block:var(--s4)">
        ${cart.bags.map((b) => `
          <div class="manifest-row row" style="justify-content:space-between">
            <span class="mono fs-sm">${esc(b.tagNumber)}</span>
            <button type="button" class="btn btn-ghost btn-icon" data-remove="${esc(b.id)}" aria-label="Remove bag">${icon('x', 16)}</button>
          </div>`).join('') || '<p class="fs-xs muted">No bags scanned yet.</p>'}
      </div>
      <button type="button" class="btn btn-danger btn-block" id="close-cart" ${cart.status === 'Closed' ? 'disabled' : ''}>${icon('lock', 16)} ${cart.status === 'Closed' ? 'Cart closed' : 'Close cart'}</button>`;
    createScanInput(body().querySelector('#cart-bag-scan'), {
      label: 'Scan a bag tag',
      placeholder: 'Scan or type bag tag',
      onSubmit: async (code) => {
        const res = await api.scanBagIntoCart(cartId, code);
        cart = res.cart;
        renderLoadStep();
        return { message: `${res.bag.tagNumber} added to ${cartId}.` };
      },
    });
    body().querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      cart = await api.removeBagFromCart(cartId, btn.dataset.remove);
      renderLoadStep();
    }));
    body().querySelector('#close-cart').addEventListener('click', async () => {
      try {
        cart = await api.closeCart(cartId);
        toast(`${cartId} closed with ${cart.bags.length} bags.`, 'success');
        drawer.close();
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  api.getCarts().then((carts) => {
    cart = carts.find((c) => c.id === cartId);
    if (cart.bags.length || cart.status !== 'Open') renderLoadStep(); else renderConfirmStep();
  });
}

/* ===================== TRUCKS ===================== */

async function loadTrucks(root) {
  const trucks = await api.getTrucks();
  if (!appEl) return;
  root.innerHTML = `<div class="grid grid-cols-3" id="truck-cards"></div>`;
  renderTruckCards(root.querySelector('#truck-cards'), trucks);
}

function renderTruckCards(root, trucks) {
  root.innerHTML = trucks.map((t) => `
    <div class="card" style="${t.status === 'Out of Service' ? 'opacity:.55' : ''}">
      <div class="row" style="justify-content:space-between">
        <strong class="mono">${esc(t.id)}</strong>${statusChip(t.status)}
      </div>
      <p class="fs-sm muted" style="margin-block-start:4px">${t.bagsCount} bags${t.driverName ? ` · ${esc(t.driverName)}` : ''}</p>
      <button type="button" class="btn btn-primary btn-block" style="margin-block-start:var(--s4)" data-truck="${esc(t.id)}" ${t.status === 'Out of Service' ? 'disabled' : ''}>
        ${icon('truck', 16)} ${t.loadedAt ? 'View manifest' : 'Load truck'}
      </button>
    </div>`).join('');
  root.querySelectorAll('[data-truck]').forEach((btn) => btn.addEventListener('click', () => openTruckDrawer(btn.dataset.truck)));
}

function openTruckDrawer(truckId) {
  let truck = null;
  const drawer = openDrawer({ title: `Load ${truckId}`, bodyHtml: `<div id="truck-drawer-body"></div>`, large: true });
  function body() { return drawer.el.querySelector('#truck-drawer-body'); }

  function renderConfirmStep() {
    body().innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Scan the truck QR to begin loading.</p>
      <div id="truck-confirm-scan"></div>`;
    createScanInput(body().querySelector('#truck-confirm-scan'), {
      label: 'Scan the truck QR',
      placeholder: 'Scan or type the truck ID',
      onSubmit: async (code) => {
        truck = await api.confirmTruckScan(truckId, code);
        renderLoadStep();
        return { message: `${truckId} ready for loading.` };
      },
    });
  }

  function renderLoadStep() {
    body().innerHTML = `
      <div class="card" style="margin-block-end:var(--s4)">
        <div class="fs-sm muted">Bags loaded</div>
        <div class="fs-xl fw-bold">${truck.bagIds.length}</div>
      </div>
      <div id="truck-item-scan"></div>
      <div class="field" style="margin-block-start:var(--s4)">
        <label for="driver-name">Driver name <span class="req">*</span></label>
        <input id="driver-name" value="${esc(truck.driverName || '')}" />
        <div class="error" id="err-driver" hidden></div>
      </div>
      <div id="truck-complete-scan" style="margin-block-start:var(--s4)"></div>`;
    createScanInput(body().querySelector('#truck-item-scan'), {
      label: 'Scan a cart or bag to load',
      placeholder: 'Scan or type a cart or bag code',
      onSubmit: async (code) => {
        const res = await api.scanIntoTruck(truckId, code);
        truck = await api.getTrucks().then((list) => list.find((t) => t.id === truckId));
        renderLoadStep();
        return { message: res.type === 'cart' ? `${res.cartId} loaded (${res.bagsAdded} bags).` : `1 bag loaded.` };
      },
    });
    body().querySelector('#driver-name').addEventListener('blur', async (e) => {
      const err = body().querySelector('#err-driver');
      try { await api.setDriverName(truckId, e.target.value); err.hidden = true; } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    });
    createScanInput(body().querySelector('#truck-complete-scan'), {
      label: 'Scan the truck QR to confirm loading complete',
      placeholder: 'Scan or type the truck ID',
      onSubmit: async (code) => {
        const res = await api.completeTruckLoad(truckId, code);
        renderSummary(res.manifest);
        return { message: 'Truck loading complete.' };
      },
    });
  }

  function renderSummary(manifest) {
    body().innerHTML = `
      <div class="state-block" style="padding-block:var(--s6)">
        ${icon('check-circle', 48)}
        <p class="fw-semibold">Loading complete — ${esc(truckId)}</p>
      </div>
      <div class="print-area">
        <div class="manifest-preview">
          <h2 class="section-title">Collection manifest</h2>
          <p class="fs-sm">Truck ${esc(manifest.truckId)} · Driver ${esc(manifest.driverName)} · ${new Date(manifest.time).toLocaleString()}</p>
          ${manifest.groups.map((g) => `
            <h3 class="fs-sm fw-semibold" style="margin-block-start:var(--s4)">${esc(g.flightCode)} — ${g.bagCount} bags</h3>
            <div class="stack">${g.tags.map((tg) => `<div class="fs-xs mono">${esc(tg)}</div>`).join('')}</div>`).join('')}
        </div>
      </div>
      <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s4)" id="print-manifest">${icon('printer', 16)} Print manifest</button>`;
    body().querySelector('#print-manifest').addEventListener('click', () => window.print());
    toast('Collection manifest ready.', 'success');
    load();
  }

  api.getTrucks().then((list) => {
    truck = list.find((t) => t.id === truckId);
    if (truck.loadedAt) { api.getManifest(truck.manifestId).then(renderSummary); return; }
    if (truck.bagIds.length || truck.driverName) renderLoadStep(); else renderConfirmStep();
  });
}
