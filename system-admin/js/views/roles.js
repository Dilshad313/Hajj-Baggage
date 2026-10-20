import * as api from '../api.js';
import { skeletonBlock, errorState, toast, confirmDialog, openDrawer, closeDrawer, openModal, esc, icon } from '../ui.js';

let appEl = null;
let data = null; // { roles, modules, levels, permissions, counts }

const ROLE_DESCRIPTIONS = {
  checkin: 'Checks pilgrims in and tags bags at a city centre.',
  warehouse: 'Screens, stores and loads bags at the warehouse.',
  driver: 'Moves bags between centres, warehouse and airport.',
  airport: 'Coordinates bag flow and truck handover at the airport.',
  airline: 'Receives bags and reconciles manifests for a flight.',
  groundhandler: 'Handles ramp loading and offload on behalf of an airline.',
  accommodation: 'Receives and sorts bags at the hotel.',
  delivery: 'Delivers sorted bags to the pilgrim’s room.',
  opsmanager: 'Supervises both workflows and resolves exceptions.',
  sysadmin: 'Owns platform configuration, users and monitoring.',
};

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(6);
  try {
    data = await api.getRoles();
    renderGrid();
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function pageShell() {
  return `<div class="page-header"><div><h1 class="page-title">Roles &amp; permissions</h1><p class="page-subtitle">Default access per role across the platform.</p></div></div>`;
}

function renderGrid() {
  appEl.innerHTML = pageShell() + `
    <div class="grid grid-auto">
      ${data.roles.map((r) => `
        <div class="card stack gap-2">
          <div class="row" style="justify-content:space-between">
            <h2 class="section-title" style="margin:0">${esc(r.label)}</h2>
            <span class="chip chip-grey">${data.counts[r.id] ?? 0} user${(data.counts[r.id] ?? 0) === 1 ? '' : 's'}</span>
          </div>
          <p class="fs-sm text-2" style="min-height:40px">${esc(ROLE_DESCRIPTIONS[r.id] || '')}</p>
          <button type="button" class="btn btn-secondary" data-role="${esc(r.id)}">${icon('shield-check', 16)} Manage permissions</button>
        </div>`).join('')}
    </div>`;
  appEl.querySelectorAll('[data-role]').forEach((btn) => btn.addEventListener('click', () => openPermissionDrawer(btn.dataset.role)));
}

function matrixEquals(a, b) {
  for (const mod of data.modules) {
    for (const lvl of data.levels) {
      if (!!a[mod]?.[lvl] !== !!b[mod]?.[lvl]) return false;
    }
  }
  return true;
}

function cloneMatrix(m) { return JSON.parse(JSON.stringify(m)); }

function openPermissionDrawer(roleId) {
  const role = data.roles.find((r) => r.id === roleId);
  let original = data.permissions[roleId] || {};
  let working = cloneMatrix(original);
  let dirty = false;

  const drawer = openDrawer({
    title: `${role.label} — permissions`,
    bodyHtml: `<div id="perm-body"></div>`,
    footerHtml: `
      <button type="button" class="btn btn-ghost" data-act="reset">${icon('rotate-ccw', 16)} Reset to default</button>
      <span class="grow"></span>
      <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-act="save">Save changes</button>`,
    onClose: async () => {
      if (!dirty) return true;
      return confirmDialog({ title: 'Discard unsaved changes?', body: `Permission changes for ${role.label} have not been saved.`, confirmLabel: 'Discard', danger: true });
    },
  });

  function renderMatrix() {
    const body = drawer.el.querySelector('#perm-body');
    body.innerHTML = `
      <p class="muted fs-sm" style="margin-block-end:var(--s3)">${data.counts[roleId] ?? 0} user${(data.counts[roleId] ?? 0) === 1 ? '' : 's'} currently assigned to this role.</p>
      <div class="table-wrap">
        <table class="perm-matrix">
          <thead><tr><th>Module</th>${data.levels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>
            ${data.modules.map((mod) => `
              <tr>
                <th scope="row">${esc(mod)}</th>
                ${data.levels.map((lvl) => `<td><input type="checkbox" data-mod="${esc(mod)}" data-lvl="${esc(lvl)}" aria-label="${esc(mod)} ${esc(lvl)}" ${working[mod]?.[lvl] ? 'checked' : ''} /></td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    body.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', () => {
      working[cb.dataset.mod] = working[cb.dataset.mod] || {};
      working[cb.dataset.mod][cb.dataset.lvl] = cb.checked;
      dirty = !matrixEquals(working, original);
    }));
  }

  function diffRows() {
    const rows = [];
    for (const mod of data.modules) {
      for (const lvl of data.levels) {
        const before = !!original[mod]?.[lvl];
        const after = !!working[mod]?.[lvl];
        if (before !== after) rows.push({ mod, lvl, before, after });
      }
    }
    return rows;
  }

  drawer.el.querySelector('[data-act="cancel"]').addEventListener('click', () => drawer.close());
  drawer.el.querySelector('[data-act="reset"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset to default?',
      body: `This immediately restores ${role.label}'s permissions to the platform default preset.`,
      confirmLabel: 'Reset', danger: true,
    });
    if (!ok) return;
    try {
      const result = await api.resetRolePermissions(roleId);
      data.permissions[roleId] = result.matrix;
      original = cloneMatrix(result.matrix);
      working = cloneMatrix(result.matrix);
      dirty = false;
      renderMatrix();
      toast(`${role.label} permissions reset to default.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  drawer.el.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const changes = diffRows();
    if (!changes.length) { toast('No changes to save.', 'info'); return; }
    const diffHtml = `<div class="audit-diff">${changes.map((c) => `<span class="line diff-changed">~ ${esc(c.mod)} / ${esc(c.lvl)}: ${c.before ? 'Allowed' : 'Not allowed'} → ${c.after ? 'Allowed' : 'Not allowed'}</span>`).join('\n')}</div>`;
    const confirmed = await confirmDialogWithDiff(role.label, diffHtml);
    if (!confirmed) return;
    try {
      const result = await api.updateRolePermissions(roleId, working);
      data.permissions[roleId] = result.matrix;
      dirty = false;
      closeDrawer();
      toast(`${role.label} permissions updated.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  renderMatrix();
}

/** Shows the pending diff and asks for confirmation before committing a permission change. @returns {Promise<boolean>} */
function confirmDialogWithDiff(roleLabel, diffHtmlStr) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => { if (settled) return; settled = true; resolve(value); };
    const close = openModal({
      title: `Confirm changes — ${roleLabel}`,
      bodyHtml: `
        <p class="fs-sm text-2" style="margin-block-end:var(--s3)">The following permissions will change:</p>
        ${diffHtmlStr}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="confirm">Save changes</button>
        </div>`,
      onDismiss: () => settle(false),
      onMount: (overlay) => {
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); settle(false); });
        overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => { close(); settle(true); });
      },
    });
  });
}
