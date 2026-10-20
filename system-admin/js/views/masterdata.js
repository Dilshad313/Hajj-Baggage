import * as api from '../api.js';
import { skeletonBlock, errorState, toast, confirmDialog, openDrawer, closeDrawer, esc, icon, fmtDate } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let table = null;
let rows = [];
let activeTab = 'centres';

const TABS = [
  { key: 'centres', label: 'Centres', singular: 'centre' },
  { key: 'warehouses', label: 'Warehouses', singular: 'warehouse' },
  { key: 'airports', label: 'Airports', singular: 'airport' },
  { key: 'hotels', label: 'Hotels', singular: 'hotel' },
  { key: 'vehicles', label: 'Vehicles', singular: 'vehicle' },
  { key: 'flights', label: 'Flights', singular: 'flight' },
];

const SEARCH_KEYS = {
  centres: ['code', 'name', 'city'],
  warehouses: ['code', 'name', 'city'],
  airports: ['code', 'name'],
  hotels: ['code', 'name', 'city'],
  vehicles: ['code', 'type'],
  flights: ['code', 'route', 'status'],
};

const FIELD_DEFS = {
  centres: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'city', label: 'City', required: true },
  ],
  warehouses: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'city', label: 'City', required: true },
    { key: 'bays', label: 'Bays', type: 'number', required: true },
    { key: 'zones', label: 'Zones', type: 'array', hint: 'Comma-separated, e.g. Screening, Storage A' },
  ],
  airports: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'gates', label: 'Gates', type: 'array', hint: 'Comma-separated, e.g. G1, G2, G3' },
    { key: 'offloadBays', label: 'Offload bays', type: 'array', hint: 'Comma-separated, e.g. OB1, OB2' },
  ],
  hotels: [
    { key: 'code', label: 'Code', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'city', label: 'City', required: true },
    { key: 'buildings', label: 'Buildings', type: 'array', hint: 'Comma-separated, e.g. A, B' },
    { key: 'bays', label: 'Bays', type: 'array', hint: 'Comma-separated, e.g. Bay 1, Bay 2' },
  ],
  vehicles: [
    { key: 'code', label: 'Code', required: true },
    { key: 'type', label: 'Type', required: true, hint: 'e.g. Collection Truck, Trolley, Dolly' },
    { key: 'capacity', label: 'Capacity', type: 'number', required: true },
  ],
  flights: [
    { key: 'code', label: 'Flight code', required: true },
    { key: 'route', label: 'Route', required: true, hint: 'e.g. JED → CGK' },
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'status', label: 'Status', required: true, hint: 'e.g. Open, Arrived, Landed' },
  ],
};

/**
 * Renders the master data screen for route #/masterdata: tabbed CRUD over
 * centres, warehouses, airports, hotels, vehicles and flights.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void, poll:()=>void, refresh:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  load(activeTab);
  return { destroy, poll: pollActiveTab, refresh: () => load(activeTab) };
}

/** Tears down the view when the router navigates away. */
export function destroy() {
  appEl = null;
  table = null;
}

function tabMeta(type) { return TABS.find((t) => t.key === type); }

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function pageShell() {
  const meta = tabMeta(activeTab);
  return `
    <div class="page-header">
      <div><h1 class="page-title">Master data</h1><p class="page-subtitle">Centres, warehouses, airports, hotels, vehicles and flights used across the platform.</p></div>
      <button type="button" class="btn btn-primary" data-action="add">${icon('plus', 18)} Add ${esc(meta.singular)}</button>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${t.key === activeTab}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="md-table-root"></div>`;
}

function bindShell() {
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tab !== activeTab) load(btn.dataset.tab);
  }));
  appEl.querySelector('[data-action="add"]').addEventListener('click', () => openRecordDrawer(activeTab, null));
}

async function load(type) {
  if (!appEl) return;
  activeTab = type;
  appEl.innerHTML = pageShell();
  bindShell();
  const root = appEl.querySelector('#md-table-root');
  root.innerHTML = skeletonBlock(6);
  try {
    const data = await api.getMasterData(type);
    if (activeTab !== type) return;
    rows = data;
    renderTable();
  } catch (err) {
    if (activeTab !== type) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', () => load(type));
  }
}

async function pollActiveTab() {
  if (!appEl || !table) return;
  try {
    const data = await api.getMasterData(activeTab);
    rows = data;
    table.setRows(rows);
  } catch (e) { /* silent background refresh */ }
}

function columnsFor(type) {
  switch (type) {
    case 'centres':
      return [
        { key: 'code', label: 'Code', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'city', label: 'City', sortable: true },
      ];
    case 'warehouses':
      return [
        { key: 'code', label: 'Code', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'city', label: 'City', sortable: true },
        { key: 'bays', label: 'Bays', sortable: true },
        { key: 'zones', label: 'Zones', render: (r) => esc((r.zones || []).join(', ')), csvValue: (r) => (r.zones || []).join(', ') },
      ];
    case 'airports':
      return [
        { key: 'code', label: 'Code', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'gates', label: 'Gates', render: (r) => esc((r.gates || []).join(', ')), csvValue: (r) => (r.gates || []).join(', ') },
        { key: 'offloadBays', label: 'Offload bays', render: (r) => esc((r.offloadBays || []).join(', ')), csvValue: (r) => (r.offloadBays || []).join(', ') },
      ];
    case 'hotels':
      return [
        { key: 'code', label: 'Code', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'city', label: 'City', sortable: true },
        { key: 'buildings', label: 'Buildings', render: (r) => esc((r.buildings || []).join(', ')), csvValue: (r) => (r.buildings || []).join(', ') },
        { key: 'bays', label: 'Bays', render: (r) => esc((r.bays || []).join(', ')), csvValue: (r) => (r.bays || []).join(', ') },
      ];
    case 'vehicles':
      return [
        { key: 'code', label: 'Code', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'type', label: 'Type', sortable: true },
        { key: 'capacity', label: 'Capacity', sortable: true },
      ];
    case 'flights':
      return [
        { key: 'code', label: 'Flight', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'route', label: 'Route', sortable: true },
        { key: 'date', label: 'Date', sortable: true, render: (r) => fmtDate(r.date), csvValue: (r) => r.date },
        { key: 'status', label: 'Flight status', sortable: true, render: (r) => statusChip(r.status) },
      ];
    default:
      return [];
  }
}

function fullColumns(type) {
  return [
    ...columnsFor(type),
    {
      key: 'active', label: 'Active', sortable: true,
      render: (r) => statusChip(r.active ? 'Active' : 'Inactive', { color: r.active ? 'green' : 'red' }),
      csvValue: (r) => (r.active ? 'Active' : 'Inactive'),
    },
    {
      key: 'actions', label: 'Actions', csvValue: () => '',
      render: (r) => `
        <div class="row gap-1" data-stop-row-click>
          <button type="button" class="btn btn-ghost btn-icon" data-act="edit" data-id="${esc(r.id)}" aria-label="Edit ${esc(r.code)}" title="Edit">${icon('pencil', 16)}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-act="${r.active ? 'deactivate' : 'activate'}" data-id="${esc(r.id)}" aria-label="${r.active ? 'Deactivate' : 'Activate'} ${esc(r.code)}" title="${r.active ? 'Deactivate' : 'Activate'}">${icon(r.active ? 'ban' : 'rotate-ccw', 16)}</button>
        </div>`,
    },
  ];
}

function renderTable() {
  const root = appEl.querySelector('#md-table-root');
  const meta = tabMeta(activeTab);
  table = createDataTable(root, {
    rows,
    columns: fullColumns(activeTab),
    searchKeys: SEARCH_KEYS[activeTab],
    getRowId: (r) => r.id,
    csvFilename: activeTab,
    emptyMessage: `No ${meta.label.toLowerCase()} found.`,
    onRowClick: (row) => openRecordDrawer(activeTab, row),
  });
  root.addEventListener('click', (e) => {
    const stopZone = e.target.closest('[data-stop-row-click]');
    if (!stopZone) return;
    e.stopPropagation();
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'edit') openRecordDrawer(activeTab, rows.find((r) => r.id === id));
    if (btn.dataset.act === 'deactivate') deactivateFlow(activeTab, id);
    if (btn.dataset.act === 'activate') activateFlow(activeTab, id);
  });
}

async function deactivateFlow(type, id) {
  const record = rows.find((r) => r.id === id);
  if (!record) return;
  const meta = tabMeta(type);
  const ok = await confirmDialog({
    title: `Deactivate ${record.code}?`,
    body: `This ${meta.singular} will be hidden from active selection lists elsewhere in the platform. It can be reactivated at any time from this screen.`,
    confirmLabel: 'Deactivate',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deactivateMasterData(type, id);
    toast(`${record.code} deactivated.`, 'success');
    load(type);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function activateFlow(type, id) {
  const record = rows.find((r) => r.id === id);
  if (!record) return;
  try {
    await api.updateMasterData(type, id, { active: true });
    toast(`${record.code} reactivated.`, 'success');
    load(type);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function fieldHtml(def, value) {
  const id = `md-${def.key}`;
  let inputHtml;
  if (def.type === 'array') {
    const text = Array.isArray(value) ? value.join(', ') : '';
    inputHtml = `<input id="${id}" type="text" value="${esc(text)}" placeholder="Comma-separated" />`;
  } else if (def.type === 'number') {
    inputHtml = `<input id="${id}" type="number" min="1" step="1" value="${esc(value ?? '')}" />`;
  } else if (def.type === 'date') {
    const dateVal = value ? new Date(value).toISOString().slice(0, 10) : '';
    inputHtml = `<input id="${id}" type="date" value="${esc(dateVal)}" />`;
  } else {
    inputHtml = `<input id="${id}" type="text" value="${esc(value ?? '')}" />`;
  }
  return `
    <div class="field">
      <label for="${id}">${esc(def.label)}${def.required ? ' <span class="req">*</span>' : ''}</label>
      ${inputHtml}
      ${def.hint ? `<div class="hint">${esc(def.hint)}</div>` : ''}
      <div class="error" id="err-${id}" hidden></div>
    </div>`;
}

async function openRecordDrawer(type, record) {
  const isEdit = !!record;
  const defs = FIELD_DEFS[type];
  const meta = tabMeta(type);
  let dirty = false;

  const drawer = openDrawer({
    title: isEdit ? `Edit ${meta.singular} — ${record.code}` : `Add ${meta.singular}`,
    bodyHtml: `<div class="stack">${defs.map((def) => fieldHtml(def, isEdit ? record[def.key] : undefined)).join('')}</div>`,
    footerHtml: `
      <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-act="save">${isEdit ? 'Save changes' : `Add ${meta.singular}`}</button>`,
    onClose: async () => {
      if (!dirty) return true;
      return confirmDialog({ title: 'Discard unsaved changes?', body: `Changes to this ${meta.singular} have not been saved.`, confirmLabel: 'Discard', danger: true });
    },
  });

  defs.forEach((def) => {
    drawer.el.querySelector(`#md-${def.key}`)?.addEventListener('input', () => { dirty = true; });
  });

  function fieldError(key, msg) {
    const el = drawer.el.querySelector(`#err-md-${key}`);
    const input = drawer.el.querySelector(`#md-${key}`);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; input?.setAttribute('aria-invalid', 'true'); }
    else { el.hidden = true; input?.removeAttribute('aria-invalid'); }
  }

  function readForm() {
    let valid = true;
    const payload = {};
    for (const def of defs) {
      const input = drawer.el.querySelector(`#md-${def.key}`);
      const raw = input.value.trim();
      if (def.type === 'array') {
        payload[def.key] = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
        fieldError(def.key, '');
      } else if (def.type === 'number') {
        const num = Number(raw);
        if (!raw || !Number.isInteger(num) || num <= 0) {
          fieldError(def.key, `${def.label} must be a positive whole number.`);
          valid = false;
        } else {
          payload[def.key] = num;
          fieldError(def.key, '');
        }
      } else {
        if (def.required && !raw) {
          fieldError(def.key, `${def.label} is required.`);
          valid = false;
        } else {
          fieldError(def.key, '');
        }
        payload[def.key] = raw;
      }
    }
    if (payload.code) {
      const dup = rows.some((r) => r.code.toLowerCase() === payload.code.toLowerCase() && (!isEdit || r.id !== record.id));
      if (dup) { fieldError('code', 'Code already exists.'); valid = false; }
    }
    return { valid, payload };
  }

  drawer.el.querySelector('[data-act="cancel"]').addEventListener('click', () => drawer.close());
  drawer.el.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const { valid, payload } = readForm();
    if (!valid) return;
    const btn = drawer.el.querySelector('[data-act="save"]');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      if (isEdit) {
        await api.updateMasterData(type, record.id, payload);
        toast(`${capitalize(meta.singular)} updated.`, 'success');
      } else {
        await api.createMasterData(type, payload);
        toast(`${capitalize(meta.singular)} added.`, 'success');
      }
      dirty = false;
      closeDrawer();
      load(type);
    } catch (err) {
      if (/code already exists/i.test(err.message)) fieldError('code', err.message);
      else toast(err.message, 'error');
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  });
}
