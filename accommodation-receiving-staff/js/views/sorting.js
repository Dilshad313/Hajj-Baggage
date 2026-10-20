import * as api from '../api.js';
import { esc, icon, toast, skeletonBlock, emptyState, errorState, openModal } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let board = null; // { toSort, lanes }
let loadError = '';
let scanInstance = null;
let sortTargetTimer = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  board = null;
  loadError = '';
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  clearTimeout(sortTargetTimer);
  sortTargetTimer = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Sort board</h1></div>${skeletonBlock(6)}`;
  try {
    board = await api.getSortBoard();
    if (!appEl) return;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Sort board</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
  }
}

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Sort board</h1>
        <p class="page-subtitle">${board.toSort.length} bag${board.toSort.length === 1 ? '' : 's'} waiting to be sorted.</p>
      </div>
    </div>
    <div id="sort-target-root" style="margin-block-end:var(--s5)"></div>
    <div class="grid grid-cols-2">
      <div><div id="sort-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Waiting to sort</div>
        <div id="to-sort-list"></div>
      </div>
    </div>
    <div class="section-title">Lanes</div>
    <div id="lanes-root"></div>`;

  scanInstance?.destroy();
  scanInstance = createScanInput(appEl.querySelector('#sort-scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-000301',
    onSubmit: async (code) => {
      try {
        const result = await api.sortBag(code);
        showSortTarget(result.lane);
        await refreshBoard();
        return { message: `${result.bag.tagNumber} → Building ${result.lane.building}, Floor ${result.lane.floor}, Room ${result.lane.room}.` };
      } catch (err) {
        if (err.code === 'room-unknown') openAssignRoomModal(code);
        throw err;
      }
    },
  });

  showSortTarget(null);
  renderToSortList();
  renderLanes();
}

function showSortTarget(lane) {
  const root = appEl?.querySelector('#sort-target-root');
  if (!root) return;
  clearTimeout(sortTargetTimer);
  if (!lane) {
    root.innerHTML = `<div class="card"><p class="sort-target muted" style="font-size:var(--fs-lg)">Scan a bag to see its sort target.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="card"><p class="sort-target">${icon('arrow-right', 28)} Building ${esc(lane.building)} &rarr; Floor ${esc(lane.floor)} &rarr; Room ${esc(lane.room)}</p></div>`;
  sortTargetTimer = setTimeout(() => { if (appEl) showSortTarget(null); }, 2500);
}

function renderToSortList() {
  const root = appEl?.querySelector('#to-sort-list');
  if (!root) return;
  if (!board.toSort.length) { root.innerHTML = emptyState({ message: 'Nothing waiting to be sorted.' }); return; }
  root.innerHTML = `
    <div class="stack gap-2">
      ${board.toSort.map((b) => `
        <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)} &middot; ${esc(b.room || 'No room on file')}</div>
          </div>
          ${statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

function renderLanes() {
  const root = appEl?.querySelector('#lanes-root');
  if (!root) return;
  const keys = Object.keys(board.lanes);
  if (!keys.length) { root.innerHTML = emptyState({ message: 'No lanes configured for this hotel.' }); return; }
  root.innerHTML = `
    <div class="lane-tree">
      ${keys.map((k) => {
        const lane = board.lanes[k];
        const floorKeys = Object.keys(lane.floors).sort();
        const breakdown = floorKeys.map((f) => `Floor ${esc(f)}: ${lane.floors[f]}`).join(', ');
        return `<div class="lane-row"><strong>Building ${esc(k)}</strong><span>${lane.total} sorted${breakdown ? ` &mdash; ${breakdown}` : ''}</span></div>`;
      }).join('')}
    </div>`;
}

async function refreshBoard() {
  try {
    board = await api.getSortBoard();
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
    return;
  }
  if (!appEl) return;
  renderToSortList();
  renderLanes();
}

function openAssignRoomModal(tag) {
  const bag = board.toSort.find((b) => b.tagNumber.toLowerCase() === String(tag).trim().toLowerCase());
  if (!bag) return;
  let submitting = false;
  const close = openModal({
    title: `Assign a room — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="assign-room-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">No room is on file for ${esc(bag.pilgrimName)}. Assign one, then re-scan the tag to sort it.</p>
        <div class="field">
          <label for="assign-room-input">Room <span class="req">*</span></label>
          <input id="assign-room-input" placeholder="e.g. B-207" autocomplete="off" required />
          <div class="error" id="err-assign-room" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="assign-room-submit">Assign room</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('assign-room-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const room = form.querySelector('#assign-room-input').value.trim();
    const errBox = form.querySelector('#err-assign-room');
    if (!room) { errBox.textContent = 'Room is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#assign-room-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Assigning…';
    try {
      await api.assignRoom(bag.id, room);
      close();
      toast(`Room assigned — re-scan ${bag.tagNumber} to sort it.`, 'success');
      await refreshBoard();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Assign room';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}
