import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, announce, confirmDialog, openDrawer, closeDrawer, openModal,
  fmtDateTime, fmtRelative, esc, icon,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let rolesData = null; // { roles, modules, levels, permissions, counts }
let scopeOptionsCache = null; // { centre:[], warehouse:[], airport:[], hotel:[], airlineCode:[] }
let allUsers = [];
let table = null;
let filters = { q: '', role: '', status: '', location: '' };

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() {
  appEl = null;
  table = null;
}

async function ensureStaticData() {
  if (!rolesData) rolesData = await api.getRoles();
  if (!scopeOptionsCache) {
    const [centres, warehouses, airports, hotels, config] = await Promise.all([
      api.getMasterData('centres'), api.getMasterData('warehouses'),
      api.getMasterData('airports'), api.getMasterData('hotels'), api.getConfig(),
    ]);
    scopeOptionsCache = {
      centre: centres.filter((c) => c.active).map((c) => c.name),
      warehouse: warehouses.filter((w) => w.active).map((w) => w.name),
      airport: airports.filter((a) => a.active).map((a) => a.code),
      hotel: hotels.filter((h) => h.active).map((h) => h.name),
      airlineCode: config.airlines.map((a) => a.code),
    };
  }
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(8);
  try {
    await ensureStaticData();
    allUsers = await api.getUsers({});
    renderTable();
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try {
    allUsers = await api.getUsers({});
    applyFilters();
  } catch (e) { /* silent background refresh */ }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">User management</h1><p class="page-subtitle">Accounts across all 10 roles, their scope and access.</p></div>
      <button type="button" class="btn btn-primary" data-action="add-user">${icon('user-plus', 18)} Add user</button>
    </div>
    <div id="users-table-root"></div>`;
}

function locationOptions() {
  const set = new Set(allUsers.map((u) => u.scope).filter(Boolean));
  return Array.from(set).sort();
}

function renderTable() {
  appEl.innerHTML = pageShell();
  appEl.querySelector('[data-action="add-user"]').addEventListener('click', () => openUserDrawer(null));
  const root = appEl.querySelector('#users-table-root');

  const toolbarExtraHtml = `
    <select aria-label="Filter by role" data-flt="role">
      <option value="">All roles</option>
      ${rolesData.roles.map((r) => `<option value="${esc(r.id)}" ${filters.role === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
    </select>
    <select aria-label="Filter by location" data-flt="location">
      <option value="">All locations</option>
      ${locationOptions().map((l) => `<option value="${esc(l)}" ${filters.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>
    <select aria-label="Filter by status" data-flt="status">
      <option value="">All statuses</option>
      <option value="Active" ${filters.status === 'Active' ? 'selected' : ''}>Active</option>
      <option value="Disabled" ${filters.status === 'Disabled' ? 'selected' : ''}>Disabled</option>
    </select>
    <button type="button" class="btn btn-secondary" data-act="bulk-disable" hidden>${icon('ban', 16)} Disable selected</button>
  `;

  table = createDataTable(root, {
    rows: filteredRows(),
    searchKeys: ['name', 'employeeId', 'email'],
    getRowId: (u) => u.id,
    csvFilename: 'users',
    emptyMessage: 'No users match these filters.',
    selectable: true,
    toolbarExtraHtml,
    onRowClick: (row) => openUserDrawer(row.id),
    onSelectionChange: (ids) => {
      const btn = root.querySelector('[data-act="bulk-disable"]');
      if (btn) btn.hidden = ids.length === 0;
    },
    columns: [
      { key: 'name', label: 'Name', sortable: true, render: (u) => `<strong>${esc(u.name)}</strong>` },
      { key: 'employeeId', label: 'Employee ID', sortable: true, render: (u) => `<span class="mono">${esc(u.employeeId)}</span>` },
      { key: 'roleLabel', label: 'Role', sortable: true },
      { key: 'scope', label: 'Location', sortable: true, render: (u) => esc(u.scope || '—') },
      { key: 'status', label: 'Status', sortable: true, render: (u) => statusChip(u.status) },
      { key: 'lastLogin', label: 'Last login', sortable: true, render: (u) => `<span title="${esc(fmtDateTime(u.lastLogin))}">${u.lastLogin ? fmtRelative(u.lastLogin) : 'Never'}</span>`, csvValue: (u) => u.lastLogin || '' },
      { key: 'twoFA', label: '2FA', render: (u) => u.twoFA ? statusChip('Active') : statusChip('Disabled'), csvValue: (u) => u.twoFA ? 'On' : 'Off' },
      {
        key: 'actions', label: 'Actions', render: (u) => `
        <div class="row gap-1" data-stop-row-click>
          <button type="button" class="btn btn-ghost btn-icon" data-act="audit" data-id="${esc(u.id)}" aria-label="View activity for ${esc(u.name)}" title="Audit user">${icon('history', 16)}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-act="${u.status === 'Active' ? 'disable' : 'enable'}" data-id="${esc(u.id)}" aria-label="${u.status === 'Active' ? 'Disable' : 'Enable'} ${esc(u.name)}" title="${u.status === 'Active' ? 'Disable' : 'Re-enable'}">${icon(u.status === 'Active' ? 'ban' : 'rotate-ccw', 16)}</button>
        </div>`, csvValue: () => '',
      },
    ],
  });

  root.querySelectorAll('[data-flt]').forEach((sel) => sel.addEventListener('change', () => {
    filters[sel.dataset.flt] = sel.value;
    applyFilters();
  }));
  root.querySelector('[data-act="bulk-disable"]')?.addEventListener('click', bulkDisable);

  root.addEventListener('click', (e) => {
    const stopZone = e.target.closest('[data-stop-row-click]');
    if (!stopZone) return;
    e.stopPropagation();
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'audit') openAuditDrawer(id);
    if (btn.dataset.act === 'disable') disableUserFlow(id);
    if (btn.dataset.act === 'enable') enableUserFlow(id);
  });
}

function filteredRows() {
  let list = allUsers;
  if (filters.role) list = list.filter((u) => u.roleId === filters.role);
  if (filters.status) list = list.filter((u) => u.status === filters.status);
  if (filters.location) list = list.filter((u) => u.scope === filters.location);
  return list;
}

function applyFilters() {
  if (table) table.setRows(filteredRows());
}

async function bulkDisable() {
  const ids = table.getSelected();
  if (!ids.length) return;
  const reason = await promptReason(`Disable ${ids.length} selected user${ids.length === 1 ? '' : 's'}`);
  if (reason === null) return;
  let okCount = 0;
  for (const id of ids) {
    try { await api.disableUser(id, reason); okCount++; } catch (e) { /* continue others */ }
  }
  toast(`${okCount} user${okCount === 1 ? '' : 's'} disabled.`, okCount ? 'success' : 'error');
  table.clearSelection();
  load();
}

/** @param {string} title @returns {Promise<string|null>} */
function promptReason(title) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => { if (settled) return; settled = true; resolve(value); };
    const close = openModal({
      title,
      bodyHtml: `
        <div class="field">
          <label for="bulk-reason">Reason <span class="req">*</span></label>
          <textarea id="bulk-reason" minlength="5" maxlength="300" placeholder="Reason for disabling (5–300 characters)"></textarea>
          <div class="error" id="bulk-reason-err" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-danger" data-act="confirm">Disable</button>
        </div>`,
      onDismiss: () => settle(null),
      onMount: (overlay) => {
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); settle(null); });
        overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => {
          const val = overlay.querySelector('#bulk-reason').value.trim();
          const err = overlay.querySelector('#bulk-reason-err');
          if (val.length < 5 || val.length > 300) {
            err.textContent = 'Reason must be 5–300 characters.'; err.hidden = false;
            return;
          }
          close(); settle(val);
        });
      },
    });
  });
}

async function disableUserFlow(id) {
  const user = allUsers.find((u) => u.id === id);
  if (!user) return;
  const reason = await promptReason(`Disable ${user.name}`);
  if (reason === null) return;
  try {
    await api.disableUser(id, reason);
    toast(`${user.name} has been disabled.`, 'success');
    announce(`${user.name} disabled.`);
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function enableUserFlow(id) {
  const user = allUsers.find((u) => u.id === id);
  if (!user) return;
  const ok = await confirmDialog({ title: `Re-enable ${user.name}?`, body: 'This restores their access immediately.', confirmLabel: 'Re-enable' });
  if (!ok) return;
  try {
    await api.enableUser(id);
    toast(`${user.name} re-enabled.`, 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ===================== Audit user drawer ===================== */

async function openAuditDrawer(id) {
  const user = allUsers.find((u) => u.id === id);
  if (!user) return;
  const drawer = openDrawer({
    title: `Activity — ${user.name}`,
    bodyHtml: `
      <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
        <div class="field" style="margin:0;flex:1"><label for="aud-from">From</label><input id="aud-from" type="date" /></div>
        <div class="field" style="margin:0;flex:1"><label for="aud-to">To</label><input id="aud-to" type="date" /></div>
        <div class="field" style="margin:0;flex:1"><label for="aud-action">Action</label>
          <select id="aud-action"><option value="">All actions</option></select>
        </div>
      </div>
      <div id="aud-list">${skeletonBlock(4)}</div>`,
    footerHtml: `<button type="button" class="btn btn-secondary" data-act="export-csv">${icon('download', 16)} Export CSV</button>`,
  });

  let entries = [];
  async function loadEntries() {
    const from = drawer.el.querySelector('#aud-from').value || undefined;
    const to = drawer.el.querySelector('#aud-to').value || undefined;
    const list = drawer.el.querySelector('#aud-list');
    list.innerHTML = skeletonBlock(4);
    try {
      entries = await api.getUserActivity(id, { from, to });
      const actionSel = drawer.el.querySelector('#aud-action');
      const actions = Array.from(new Set(entries.map((e) => e.action)));
      actionSel.innerHTML = `<option value="">All actions</option>` + actions.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
      renderEntries();
    } catch (err) {
      list.innerHTML = errorState({ message: err.message });
      list.querySelector('[data-action="retry"]')?.addEventListener('click', loadEntries);
    }
  }
  function renderEntries() {
    const actionFilter = drawer.el.querySelector('#aud-action').value;
    const list = drawer.el.querySelector('#aud-list');
    const filtered = actionFilter ? entries.filter((e) => e.action === actionFilter) : entries;
    if (!filtered.length) { list.innerHTML = `<p class="muted fs-sm">No activity recorded for this filter.</p>`; return; }
    list.innerHTML = `<div class="stack gap-3">${filtered.map((e) => `
      <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
        <span class="fs-sm">${esc(e.action)} <span class="muted">· ${esc(e.entity)}</span></span>
        <span class="fs-xs muted" title="${esc(fmtDateTime(e.time))}">${fmtRelative(e.time)}</span>
      </div>`).join('')}</div>`;
  }
  drawer.el.querySelector('#aud-from').addEventListener('change', loadEntries);
  drawer.el.querySelector('#aud-to').addEventListener('change', loadEntries);
  drawer.el.querySelector('#aud-action').addEventListener('change', renderEntries);
  drawer.el.querySelector('[data-act="export-csv"]').addEventListener('click', () => {
    import('../ui.js').then(({ toCsv, downloadBlob }) => {
      const csv = toCsv(entries.map((e) => ({ time: e.time, action: e.action, entity: e.entity, entityId: e.entityId, result: e.result })), ['time', 'action', 'entity', 'entityId', 'result']);
      downloadBlob(`user-activity-${user.employeeId}.csv`, csv, 'text/csv');
    });
  });
  await loadEntries();
}

/* ===================== Add / Edit user drawer ===================== */

const STEP_LABELS = ['Details', 'Role & scope', 'Permissions', 'Credentials'];

function emptyForm() {
  return { employeeId: '', name: '', phone: '', email: '', roleId: '', scope: '', overrides: {} };
}

async function openUserDrawer(userId) {
  const isEdit = !!userId;
  let existing = null;
  let formData = emptyForm();
  let createdUser = null;
  let step = 1;
  let dirty = false;
  let overridesInitializedForRole = null;

  if (isEdit) {
    try {
      existing = await api.getUser(userId);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    formData = {
      employeeId: existing.employeeId, name: existing.name, phone: existing.phone, email: existing.email,
      roleId: existing.roleId, scope: existing.scope || '', overrides: {},
    };
  }
  const totalSteps = isEdit ? 3 : 4;

  const drawer = openDrawer({
    title: isEdit ? `Edit user — ${existing.name}` : 'Add user',
    bodyHtml: `<div id="user-step-body"></div>`,
    footerHtml: `<div id="user-step-footer"></div>`,
    onClose: async () => {
      if (!dirty) {
        if (createdUser) load();
        return true;
      }
      return confirmDialog({ title: 'Discard unsaved changes?', body: 'Changes to this user have not been saved.', confirmLabel: 'Discard', danger: true });
    },
  });

  function roleById(id) { return rolesData.roles.find((r) => r.id === id); }

  function renderStepper() {
    return `<div class="sr-stepper">${STEP_LABELS.slice(0, totalSteps).map((label, i) => {
      const n = i + 1;
      const cls = n < step ? 'done' : '';
      return `<div class="sr-step ${cls}" ${n === step ? 'aria-current="step"' : ''}><span class="num">${n < step ? '✓' : n}</span>${esc(label)}</div>`;
    }).join('')}</div>`;
  }

  function fieldError(id, msg) {
    const el = drawer.el.querySelector(`#err-${id}`);
    const input = drawer.el.querySelector(`#${id}`);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; input?.setAttribute('aria-invalid', 'true'); }
    else { el.hidden = true; input?.removeAttribute('aria-invalid'); }
  }

  function renderStep1() {
    const body = drawer.el.querySelector('#user-step-body');
    body.innerHTML = `
      ${renderStepper()}
      <div class="field">
        <label for="u-name">Full name <span class="req">*</span></label>
        <input id="u-name" value="${esc(formData.name)}" />
        <div class="error" id="err-u-name" hidden></div>
      </div>
      <div class="field">
        <label for="u-employeeId">Employee ID <span class="req">*</span></label>
        <input id="u-employeeId" value="${esc(formData.employeeId)}" placeholder="e.g. CHK-007" ${isEdit ? 'disabled' : ''} />
        <div class="hint">Must match the role prefix, e.g. CHK-007 for Check-in Staff.</div>
        <div class="error" id="err-u-employeeId" hidden></div>
      </div>
      <div class="field">
        <label for="u-phone">Phone <span class="req">*</span></label>
        <input id="u-phone" value="${esc(formData.phone)}" placeholder="+9665XXXXXXXX" />
        <div class="error" id="err-u-phone" hidden></div>
      </div>
      <div class="field">
        <label for="u-email">Email <span class="req">*</span></label>
        <input id="u-email" type="email" value="${esc(formData.email)}" />
        <div class="error" id="err-u-email" hidden></div>
      </div>
      ${isEdit ? `<div id="u-sessions"></div>` : ''}`;
    ['u-name', 'u-employeeId', 'u-phone', 'u-email'].forEach((id) => {
      drawer.el.querySelector(`#${id}`)?.addEventListener('input', () => { dirty = true; });
      drawer.el.querySelector(`#${id}`)?.addEventListener('blur', () => validateStep1(false));
    });
    if (isEdit) renderSessions();
    renderFooter();
  }

  function renderSessions() {
    const el = drawer.el.querySelector('#u-sessions');
    if (!el) return;
    const sessions = existing.activeSessions || [];
    el.innerHTML = `
      <div class="card" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between">
          <h2 class="section-title" style="margin:0">Active sessions</h2>
          <button type="button" class="btn btn-secondary" data-act="revoke-sessions" ${sessions.length ? '' : 'disabled'}>${icon('log-out', 16)} Revoke all</button>
        </div>
        ${sessions.length
          ? `<div class="stack gap-2" style="margin-block-start:var(--s3)">${sessions.map((s) => `
              <div class="row fs-sm" style="justify-content:space-between">
                <span>${esc(s.device)}</span>
                <span class="muted fs-xs">since ${esc(fmtRelative(s.since))}</span>
              </div>`).join('')}</div>`
          : `<p class="muted fs-sm" style="margin-block-start:var(--s3)">No active sessions.</p>`}
      </div>`;
    el.querySelector('[data-act="revoke-sessions"]')?.addEventListener('click', async () => {
      try {
        await api.revokeTokens(existing.id);
        existing.activeSessions = [];
        toast('All sessions revoked.', 'success');
        renderSessions();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function validateStep1(onSubmit) {
    let valid = true;
    const name = drawer.el.querySelector('#u-name').value.trim();
    const employeeId = drawer.el.querySelector('#u-employeeId').value.trim();
    const phone = drawer.el.querySelector('#u-phone').value.trim();
    const email = drawer.el.querySelector('#u-email').value.trim();
    if (name.length < 3 || name.length > 80) { fieldError('u-name', 'Full name must be 3–80 characters.'); valid = false; } else fieldError('u-name', '');
    const role = roleById(formData.roleId) || (employeeId ? rolesData.roles.find((r) => employeeId.toUpperCase().startsWith(r.prefix + '-')) : null);
    const prefixRe = role ? new RegExp(`^${role.prefix}-\\d{3}$`, 'i') : null;
    if (!employeeId) { fieldError('u-employeeId', 'Employee ID is required.'); valid = false; }
    else if (prefixRe && !prefixRe.test(employeeId)) { fieldError('u-employeeId', `Employee ID must match pattern ${role.prefix}-000.`); valid = false; }
    else fieldError('u-employeeId', '');
    if (!/^\+\d{8,15}$/.test(phone)) { fieldError('u-phone', 'Phone must start with + and have 8–15 digits.'); valid = false; } else fieldError('u-phone', '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldError('u-email', 'Enter a valid email address.'); valid = false; } else fieldError('u-email', '');
    if (onSubmit && valid) { formData.name = name; formData.employeeId = employeeId; formData.phone = phone; formData.email = email; }
    return valid;
  }

  function renderStep2() {
    const body = drawer.el.querySelector('#user-step-body');
    const role = roleById(formData.roleId);
    const needsScope = role && role.scopeType !== 'none';
    const scopeOptions = role ? scopeOptionsCache[role.scopeType] || [] : [];
    body.innerHTML = `
      ${renderStepper()}
      <div class="field">
        <label for="u-role">Role <span class="req">*</span></label>
        <select id="u-role" ${isEdit ? 'disabled' : ''}>
          <option value="">Select a role…</option>
          ${rolesData.roles.map((r) => `<option value="${esc(r.id)}" ${formData.roleId === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
        <div class="error" id="err-u-role" hidden></div>
      </div>
      ${needsScope ? `
      <div class="field">
        <label for="u-scope">${esc(role.scopeLabel)} <span class="req">*</span></label>
        <select id="u-scope">
          <option value="">Select…</option>
          ${scopeOptions.map((s) => `<option value="${esc(s)}" ${formData.scope === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <div class="error" id="err-u-scope" hidden></div>
      </div>` : `<p class="muted fs-sm">This role has no location scope.</p>`}
    `;
    drawer.el.querySelector('#u-role').addEventListener('change', (e) => { formData.roleId = e.target.value; formData.scope = ''; dirty = true; renderStep2(); });
    drawer.el.querySelector('#u-scope')?.addEventListener('change', (e) => { formData.scope = e.target.value; dirty = true; });
    renderFooter();
  }

  function validateStep2() {
    let valid = true;
    if (!formData.roleId) { fieldError('u-role', 'Role is required.'); valid = false; } else fieldError('u-role', '');
    const role = roleById(formData.roleId);
    if (role && role.scopeType !== 'none') {
      const scopeVal = drawer.el.querySelector('#u-scope')?.value || '';
      if (!scopeVal) { fieldError('u-scope', `${role.scopeLabel} is required.`); valid = false; } else { formData.scope = scopeVal; fieldError('u-scope', ''); }
    }
    return valid;
  }

  function renderStep3() {
    const body = drawer.el.querySelector('#user-step-body');
    const role = roleById(formData.roleId);
    if (overridesInitializedForRole !== role.id) {
      const preset = rolesData.permissions[role.id] || {};
      const overrides = isEdit && existing.roleId === role.id ? (existing.permissions || preset) : preset;
      formData.overrides = JSON.parse(JSON.stringify(overrides));
      overridesInitializedForRole = role.id;
    }
    body.innerHTML = `
      ${renderStepper()}
      <p class="muted fs-sm" style="margin-block-end:var(--s3)">Starts from the ${esc(role.label)} preset. Override as needed for this user.</p>
      <div class="table-wrap">
        <table class="perm-matrix">
          <thead><tr><th>Module</th>${rolesData.levels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rolesData.modules.map((mod) => `
              <tr>
                <th scope="row">${esc(mod)}</th>
                ${rolesData.levels.map((lvl) => `<td><input type="checkbox" data-mod="${esc(mod)}" data-lvl="${esc(lvl)}" aria-label="${esc(mod)} ${esc(lvl)}" ${formData.overrides[mod]?.[lvl] ? 'checked' : ''} /></td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="error" id="err-u-perms" hidden style="margin-block-start:var(--s2)"></div>`;
    body.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', () => {
      dirty = true;
      formData.overrides[cb.dataset.mod] = formData.overrides[cb.dataset.mod] || {};
      formData.overrides[cb.dataset.mod][cb.dataset.lvl] = cb.checked;
    }));
    renderFooter();
  }

  function validateStep3() {
    const any = Object.values(formData.overrides).some((mod) => Object.values(mod).some(Boolean));
    fieldError('u-perms', any ? '' : 'At least one permission is required.');
    return any;
  }

  function renderStep4() {
    const body = drawer.el.querySelector('#user-step-body');
    body.innerHTML = `
      ${renderStepper()}
      <div class="card">
        <h2 class="section-title">Credentials</h2>
        <p class="fs-sm text-2">A temporary PIN has been generated for <strong>${esc(createdUser.name)}</strong> (<span class="mono">${esc(createdUser.employeeId)}</span>).</p>
        <div id="cred-result"></div>
      </div>`;
    renderFooter();
  }

  function renderFooter() {
    const footer = drawer.el.querySelector('#user-step-footer');
    if (step === totalSteps && !isEdit) {
      footer.innerHTML = `
        <button type="button" class="btn btn-primary" data-act="send-creds">${icon('send', 16)} Send credentials</button>
        <button type="button" class="btn btn-secondary" data-act="done">Done</button>`;
      footer.querySelector('[data-act="send-creds"]').addEventListener('click', sendCreds);
      footer.querySelector('[data-act="done"]').addEventListener('click', () => { closeDrawer(); load(); });
      return;
    }
    const isLast = step === totalSteps;
    footer.innerHTML = `
      ${step > 1 ? `<button type="button" class="btn btn-secondary" data-act="back">Back</button>` : `<button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>`}
      <button type="button" class="btn btn-primary" data-act="next" id="user-next-btn">
        <span class="label">${isLast ? (isEdit ? 'Save changes' : 'Create user') : 'Next'}</span>
      </button>`;
    footer.querySelector('[data-act="back"]')?.addEventListener('click', () => { step -= 1; renderCurrentStep(); });
    footer.querySelector('[data-act="cancel"]')?.addEventListener('click', () => drawer.close());
    footer.querySelector('[data-act="next"]').addEventListener('click', onNext);
  }

  function renderCurrentStep() {
    if (step === 1) renderStep1();
    else if (step === 2) renderStep2();
    else if (step === 3) renderStep3();
    else renderStep4();
  }

  async function onNext() {
    if (step === 1) { if (!validateStep1(true)) return; step = 2; renderStep2(); return; }
    if (step === 2) { if (!validateStep2()) return; step = 3; renderStep3(); return; }
    if (step === 3) {
      if (!validateStep3()) return;
      await submitForm();
      return;
    }
  }

  async function submitForm() {
    const btn = drawer.el.querySelector('#user-next-btn');
    const label = btn.querySelector('.label');
    const prevText = label.textContent;
    btn.disabled = true; btn.closest('button').setAttribute('aria-busy', 'true'); label.textContent = 'Saving…';
    try {
      if (isEdit) {
        await api.updateUser(existing.id, {
          name: formData.name, phone: formData.phone, email: formData.email,
          scope: formData.scope || null, roleId: formData.roleId, permissionOverrides: formData.overrides,
        });
        toast('User updated.', 'success');
        dirty = false;
        closeDrawer();
        load();
      } else {
        createdUser = await api.createUser({
          employeeId: formData.employeeId, name: formData.name, phone: formData.phone, email: formData.email,
          roleId: formData.roleId, scope: formData.scope || null, permissionOverrides: formData.overrides,
        });
        dirty = false;
        toast('User created.', 'success');
        step = 4;
        renderStep4();
      }
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.closest('button').removeAttribute('aria-busy'); label.textContent = prevText;
    }
  }

  async function sendCreds() {
    const btn = drawer.el.querySelector('[data-act="send-creds"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const result = await api.sendCredentials(createdUser.id);
      drawer.el.querySelector('#cred-result').innerHTML = `
        <div class="field" style="background:var(--success-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-start:var(--s3)">
          Credentials sent to ${esc(result.sentTo)}. Temporary PIN: <span class="secret-mask">${esc(result.pin)}</span>
        </div>`;
      toast('Credentials sent.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  }

  renderCurrentStep();
}
