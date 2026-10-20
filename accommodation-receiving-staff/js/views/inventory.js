import * as api from '../api.js';
import { esc, icon, toast, skeletonBlock, emptyState, errorState, openDrawer, confirmDialog } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let query = '';
let debounceTimer = null;
let bags = null;
let loadError = '';
let dataTableInstance = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  query = '';
  bags = null;
  loadError = '';
  renderShell();
  search('');
  return { destroy, refresh: () => search(query) };
}

export function destroy() {
  dataTableInstance?.destroy();
  dataTableInstance = null;
  clearTimeout(debounceTimer);
  debounceTimer = null;
  appEl = null;
}

function renderShell() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Inventory</h1>
        <p class="page-subtitle">Search for any bag at this hotel to check or fix its room.</p>
      </div>
    </div>
    <div class="field" style="max-width:420px;margin-block-end:var(--s4)">
      <label for="inventory-search">Search by tag, pilgrim name or room</label>
      <input id="inventory-search" type="search" autocomplete="off" placeholder="e.g. RBL-A-000301, Siti, A-305" />
    </div>
    <div id="inventory-results"></div>`;
  appEl.querySelector('#inventory-search').addEventListener('input', (e) => {
    query = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(query), 300);
  });
}

async function search(q) {
  const root = appEl?.querySelector('#inventory-results');
  if (!root) return;
  root.innerHTML = skeletonBlock(6);
  try {
    const result = await api.searchInventory(q);
    if (!appEl) return;
    bags = result;
    loadError = '';
    renderResults();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderResults();
  }
}

function renderResults() {
  const root = appEl?.querySelector('#inventory-results');
  if (!root) return;
  dataTableInstance?.destroy();
  dataTableInstance = null;
  if (loadError) {
    root.innerHTML = errorState({ message: loadError });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => search(query));
    return;
  }
  if (!bags.length) { root.innerHTML = emptyState({ message: 'No bags found.' }); return; }
  dataTableInstance = createDataTable(root, {
    columns: [
      { key: 'tagNumber', label: 'Tag', sortable: true, render: (b) => `<span class="mono">${esc(b.tagNumber)}</span>` },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true, render: (b) => esc(b.pilgrimName) },
      { key: 'room', label: 'Room', sortable: true, render: (b) => esc(b.room || '—') },
      { key: 'status', label: 'Status', sortable: true, render: (b) => statusChip(b.status) },
    ],
    rows: bags,
    searchKeys: ['tagNumber', 'pilgrimName', 'room', 'status'],
    getRowId: (b) => b.id,
    onRowClick: (b) => openBagDrawer(b),
    csvFilename: 'inventory',
    emptyMessage: 'No matching records.',
  });
}

function openBagDrawer(bag) {
  const { el, close } = openDrawer({
    title: bag.tagNumber,
    bodyHtml: `
      <div class="stack gap-2 fs-sm">
        <div class="row" style="justify-content:space-between"><span class="muted">Pilgrim</span><strong>${esc(bag.pilgrimName)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Room</span><strong class="mono">${esc(bag.room || '—')}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Building</span><strong>${esc(bag.building || '—')}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Status</span>${statusChip(bag.status)}</div>
      </div>
      <div class="row gap-2 wrap" style="margin-block-start:var(--s5)">
        <button type="button" class="btn btn-secondary" data-act="change-room">${icon('map-pin', 16)} Change room</button>
        ${bag.runId ? `<button type="button" class="btn btn-danger" data-act="remove-assignment">${icon('x-circle', 16)} Remove from assignment</button>` : ''}
      </div>
      <div id="change-room-root"></div>`,
  });

  el.querySelector('[data-act="change-room"]').addEventListener('click', () => renderChangeRoomForm(el, bag, close));
  el.querySelector('[data-act="remove-assignment"]')?.addEventListener('click', async () => {
    const proceed = await confirmDialog({
      title: 'Remove from assignment',
      body: 'This bag will be taken off its delivery run and returned to Sorted status.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!proceed) return;
    try {
      await api.removeFromAssignment(bag.id);
      close();
      toast(`${bag.tagNumber} removed from its run.`, 'success');
      await search(query);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderChangeRoomForm(el, bag, close) {
  const root = el.querySelector('#change-room-root');
  let submitting = false;
  root.innerHTML = `
    <form id="change-room-form" novalidate style="margin-block-start:var(--s4)">
      <div class="field">
        <label for="change-room-input">New room <span class="req">*</span></label>
        <input id="change-room-input" placeholder="e.g. B-207" autocomplete="off" required />
      </div>
      <div class="row gap-2">
        <button type="submit" class="btn btn-primary" id="change-room-submit">Save</button>
        <button type="button" class="btn btn-ghost" data-act="cancel-change-room">Cancel</button>
      </div>
    </form>`;
  const form = root.querySelector('#change-room-form');
  form.querySelector('[data-act="cancel-change-room"]').addEventListener('click', () => { root.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const room = form.querySelector('#change-room-input').value.trim();
    if (!room) { toast('Room is required.', 'error'); return; }
    submitting = true;
    const btn = form.querySelector('#change-room-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      const updated = bag.status === 'Sorted' ? await api.moveLane(bag.id, room) : await api.markRoomChanged(bag.id, room);
      close();
      toast(`${bag.tagNumber} moved to ${updated.room}.`, 'success');
      await search(query);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}
