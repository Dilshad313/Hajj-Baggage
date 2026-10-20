import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, emptyState, errorState,
  openModal,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';

let appEl = null;
let runId = null;

/* ---- list view state ---- */
let readyBags = null;
let runs = null;
let drafts = null;
let listLoadError = '';
let dataTableInstance = null;

/* ---- run detail state ---- */
let run = null;
let runLoadError = '';
let trolleyConfirmed = false;
let assigning = false;
let trolleyScanInstance = null;
let loadScanInstance = null;

const STEP_LABELS = ['Assign team & trolley', 'Scan trolley', 'Load bags', 'Notify delivery team'];

/** @param {{runId?:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  runId = params.runId || null;
  if (runId) {
    run = null; runLoadError = ''; trolleyConfirmed = false; assigning = false;
    loadRun();
  } else {
    readyBags = null; runs = null; drafts = null; listLoadError = '';
    loadList();
  }
  return { destroy, refresh: runId ? loadRun : loadList };
}

export function destroy() {
  dataTableInstance?.destroy(); dataTableInstance = null;
  trolleyScanInstance?.destroy(); trolleyScanInstance = null;
  loadScanInstance?.destroy(); loadScanInstance = null;
  appEl = null;
}

/* ===================== LIST VIEW ===================== */

async function loadList() {
  if (!appEl) return;
  renderListSkeleton();
  try {
    const [bags, allRuns] = await Promise.all([api.getReadyForDelivery(), api.getRuns()]);
    if (!appEl) return;
    readyBags = bags;
    runs = allRuns;
    listLoadError = '';
    renderList();
  } catch (err) {
    if (!appEl) return;
    listLoadError = err.message;
    renderList();
  }
}

function renderListSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Delivery planning</h1></div>${skeletonBlock(6)}`;
}

function renderList() {
  if (!appEl) return;
  if (listLoadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Delivery planning</h1></div>${errorState({ message: listLoadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadList);
    return;
  }

  const byBuilding = {};
  for (const b of readyBags) {
    byBuilding[b.building] = byBuilding[b.building] || {};
    byBuilding[b.building][b.room] = (byBuilding[b.building][b.room] || 0) + 1;
  }
  const buildings = Object.keys(byBuilding).sort();

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Delivery planning</h1>
        <p class="page-subtitle">${readyBags.length} sorted bag${readyBags.length === 1 ? '' : 's'} ready to plan for delivery.</p>
      </div>
      ${readyBags.length ? `<button type="button" class="btn btn-primary" data-action="build-plan">${icon('calendar-check', 16)} Generate draft runs</button>` : ''}
    </div>

    ${!readyBags.length ? emptyState({ message: 'No sorted bags are waiting to be planned yet. Sort some bags first.' }) : `
      <div class="section-title">Ready for delivery, by building</div>
      <div class="lane-tree" style="margin-block-end:var(--s6)">
        ${buildings.map((bld) => `
          <div class="lane-row"><strong>Building ${esc(bld)}</strong><span>${Object.values(byBuilding[bld]).reduce((a, c) => a + c, 0)} bags across ${Object.keys(byBuilding[bld]).length} rooms</span></div>
        `).join('')}
      </div>`}

    <div id="drafts-root"></div>

    <div class="section-title">Runs</div>
    <div id="runs-table"></div>`;

  appEl.querySelector('[data-action="build-plan"]')?.addEventListener('click', onBuildPlan);
  renderDrafts();
  renderRunsTable();
}

async function onBuildPlan() {
  const btn = appEl.querySelector('[data-action="build-plan"]');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    drafts = await api.buildPlan();
    if (!appEl) return;
    renderDrafts();
    toast(`${drafts.length} draft run${drafts.length === 1 ? '' : 's'} proposed.`, 'info');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

function renderDrafts() {
  const root = appEl?.querySelector('#drafts-root');
  if (!root) return;
  if (!drafts || !drafts.length) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="section-title">Draft runs (not yet saved)</div>
    <div class="grid grid-auto" style="margin-block-end:var(--s4)">
      ${drafts.map((d) => `
        <div class="card">
          <strong>Building ${esc(d.building)}</strong>
          <div class="fs-sm muted" style="margin-block:var(--s1)">${d.rooms.length} room${d.rooms.length === 1 ? '' : 's'}: ${esc(d.rooms.join(', '))}</div>
          <div class="capacity-bar" style="margin-block:var(--s2)"><div class="capacity-bar-fill ${d.bagIds.length > d.capacity ? 'over' : ''}" style="width:${Math.min(100, Math.round((d.bagIds.length / d.capacity) * 100))}%"></div></div>
          <div class="fs-xs muted">${d.bagIds.length} / ${d.capacity} bags</div>
        </div>`).join('')}
    </div>
    <div class="row gap-3" style="margin-block-end:var(--s6)">
      <button type="button" class="btn btn-primary" data-action="save-drafts">${icon('save', 16)} Save all runs</button>
      <button type="button" class="btn btn-ghost" data-action="discard-drafts">Discard</button>
    </div>`;
  root.querySelector('[data-action="save-drafts"]').addEventListener('click', onSaveDrafts);
  root.querySelector('[data-action="discard-drafts"]').addEventListener('click', () => { drafts = null; renderDrafts(); });
}

async function onSaveDrafts() {
  const btn = appEl.querySelector('[data-action="save-drafts"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.savePlan(drafts);
    drafts = null;
    toast('Runs saved as Planned.', 'success');
    await loadList();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function renderRunsTable() {
  const root = appEl?.querySelector('#runs-table');
  if (!root) return;
  dataTableInstance?.destroy();
  if (!runs.length) { root.innerHTML = emptyState({ message: 'No delivery runs yet.' }); return; }
  dataTableInstance = createDataTable(root, {
    columns: [
      { key: 'code', label: 'Run', sortable: true, render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { key: 'building', label: 'Building', sortable: true, render: (r) => `Building ${esc(r.building)}` },
      { key: 'bagIds', label: 'Bags', sortable: true, render: (r) => String(r.bagIds.length), csvValue: (r) => r.bagIds.length },
      { key: 'team', label: 'Team', sortable: true, render: (r) => esc(r.team || '—') },
      { key: 'trolleyCode', label: 'Trolley', sortable: true, render: (r) => esc(r.trolleyCode || '—') },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
    ],
    rows: runs,
    searchKeys: ['code', 'building', 'team', 'trolleyCode', 'status'],
    getRowId: (r) => r.id,
    onRowClick: (r) => navigate(`#/planning/${r.id}`),
    csvFilename: 'delivery-runs',
    emptyMessage: 'No matching runs.',
  });
}

/* ===================== RUN DETAIL VIEW ===================== */

async function loadRun() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Run</h1></div>${skeletonBlock(6)}`;
  try {
    const result = await api.getRun(runId);
    if (!appEl) return;
    run = result;
    const loadedCount = run.bags.filter((b) => b.status === 'Out for Delivery').length;
    trolleyConfirmed = run.status !== 'Assigned' || loadedCount > 0;
    runLoadError = '';
    renderRun();
  } catch (err) {
    if (!appEl) return;
    runLoadError = err.message;
    renderRun();
  }
}

function renderRun() {
  if (!appEl) return;
  if (runLoadError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/planning">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: runLoadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadRun);
    return;
  }
  const loadedCount = run.bags.filter((b) => b.status === 'Out for Delivery').length;
  const total = run.bags.length;
  const currentStepIndex = stepIndexFor(run.status, trolleyConfirmed, loadedCount, total);
  const canCancel = ['Planned', 'Assigned', 'Notified'].includes(run.status);

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/planning">${icon('arrow-left', 14)} All runs</a>
        <h1 class="page-title">${esc(run.code)} <span class="muted fs-sm">· Building ${esc(run.building)}</span></h1>
        <p class="page-subtitle">${run.rooms.join(', ')}</p>
      </div>
      <div class="row gap-2">
        ${statusChip(run.status)}
        ${canCancel ? `<button type="button" class="btn btn-ghost" data-action="cancel-run">${icon('x-circle', 16)} Cancel run</button>` : ''}
      </div>
    </div>
    ${stepperHtml(STEP_LABELS, currentStepIndex)}
    <div id="run-step-root"></div>`;

  appEl.querySelector('[data-action="cancel-run"]')?.addEventListener('click', onCancelRun);
  renderRunStep(loadedCount, total);
}

function stepIndexFor(status, confirmed, loadedCount, total) {
  if (status === 'Planned') return 1;
  if (status === 'Assigned' && !confirmed) return 2;
  if (status === 'Assigned' && loadedCount < total) return 3;
  return 4;
}

function renderRunStep(loadedCount, total) {
  const root = appEl.querySelector('#run-step-root');
  trolleyScanInstance?.destroy(); trolleyScanInstance = null;
  loadScanInstance?.destroy(); loadScanInstance = null;

  if (run.status === 'Planned') { renderAssignForm(root); return; }
  if (run.status === 'Assigned' && !trolleyConfirmed) { renderTrolleyScan(root); return; }
  if (run.status === 'Assigned' && loadedCount < total) { renderLoadStep(root, loadedCount, total); return; }
  if (run.status === 'Assigned' && loadedCount >= total) { renderNotifyPrompt(root); return; }
  renderSummary(root);
}

async function renderAssignForm(root) {
  root.innerHTML = skeletonBlock(4);
  let teams, trolleys;
  try {
    [teams, trolleys] = await Promise.all([api.getTeams(), api.getTrolleys()]);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderAssignForm(root));
    return;
  }
  if (!appEl) return;
  const activeTeams = teams.filter((t) => t.active);
  const availableTrolleys = trolleys.filter((t) => t.status === 'Available');
  root.innerHTML = `
    <div class="card" style="max-width:520px">
      <div class="section-title">Assign team &amp; trolley</div>
      ${!activeTeams.length ? `<p class="fs-sm muted">No active teams for this hotel — add one under Teams &amp; trolleys.</p>` : ''}
      ${!availableTrolleys.length ? `<p class="fs-sm muted">No available trolleys — free one up under Teams &amp; trolleys.</p>` : ''}
      <form id="assign-form" novalidate>
        <div class="field">
          <label for="assign-team">Team <span class="req">*</span></label>
          <select id="assign-team" required>
            <option value="">Select a team…</option>
            ${activeTeams.map((t) => `<option value="${esc(t.id)}" data-lead="${esc(t.leadName)}" data-members="${esc(t.memberNames.join('|'))}">${esc(t.name)} (${esc(t.leadName)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="assign-lead">Lead <span class="req">*</span></label>
          <select id="assign-lead" required><option value="">Select team first…</option></select>
        </div>
        <div class="field">
          <label for="assign-trolley">Trolley <span class="req">*</span></label>
          <select id="assign-trolley" required>
            <option value="">Select a trolley…</option>
            ${availableTrolleys.map((t) => `<option value="${esc(t.id)}" ${run.bags.length > t.capacity ? 'disabled' : ''}>${esc(t.code)} (capacity ${t.capacity})${run.bags.length > t.capacity ? ' — too small' : ''}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="assign-submit" ${!activeTeams.length || !availableTrolleys.length ? 'disabled' : ''}>Assign</button>
      </form>
    </div>`;

  const form = root.querySelector('#assign-form');
  form.querySelector('#assign-team').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const leadSelect = form.querySelector('#assign-lead');
    if (!opt || !opt.value) { leadSelect.innerHTML = '<option value="">Select team first…</option>'; return; }
    const members = opt.dataset.members.split('|');
    leadSelect.innerHTML = members.map((m) => `<option value="${esc(m)}" ${m === opt.dataset.lead ? 'selected' : ''}>${esc(m)}</option>`).join('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (assigning) return;
    const teamId = form.querySelector('#assign-team').value;
    const leadName = form.querySelector('#assign-lead').value;
    const trolleyId = form.querySelector('#assign-trolley').value;
    if (!teamId || !leadName || !trolleyId) { toast('All fields are required.', 'error'); return; }
    assigning = true;
    const btn = form.querySelector('#assign-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Assigning…';
    try {
      await api.assign(runId, { teamId, leadName, trolleyId });
      toast('Run assigned.', 'success');
      assigning = false;
      await loadRun();
    } catch (err) {
      assigning = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Assign';
      toast(err.message, 'error');
    }
  });
}

function renderTrolleyScan(root) {
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="trolley-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Assignment</div>
        <div class="stack gap-2 fs-sm">
          <div class="row" style="justify-content:space-between"><span class="muted">Team</span><strong>${esc(run.team)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Lead</span><strong>${esc(run.lead)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Trolley</span><strong class="mono">${esc(run.trolleyCode)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Bags</span><strong>${run.bags.length}</strong></div>
        </div>
      </div>
    </div>`;
  trolleyScanInstance = createScanInput(root.querySelector('#trolley-scan-root'), {
    label: 'Scan the trolley to confirm',
    placeholder: run.trolleyCode,
    onSubmit: async (code) => {
      await api.trolleyScan(runId, code);
      trolleyConfirmed = true;
      const loadedCount = run.bags.filter((b) => b.status === 'Out for Delivery').length;
      renderRun();
      return { message: 'Trolley confirmed.' };
    },
  });
}

function renderLoadStep(root, loadedCount, total) {
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="load-scan-root"></div></div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
          <div class="section-title" style="margin-block-end:0">Bags</div>
          <strong class="fs-sm">${loadedCount} / ${total} loaded</strong>
        </div>
        <div class="capacity-bar" style="margin-block-end:var(--s4)"><div class="capacity-bar-fill" style="width:${total ? Math.round((loadedCount / total) * 100) : 0}%"></div></div>
        <div class="stack gap-2">
          ${run.bags.map((b) => `
            <div class="row" style="justify-content:space-between">
              <span class="fs-sm mono">${esc(b.tagNumber)}</span>
              ${b.status === 'Out for Delivery' ? '<span class="chip chip-green">Loaded</span>' : '<span class="chip chip-grey">Pending</span>'}
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  loadScanInstance = createScanInput(root.querySelector('#load-scan-root'), {
    label: 'Scan bag tag to load onto trolley',
    placeholder: 'e.g. RBL-A-000301',
    onSubmit: async (code) => {
      const result = await api.loadTrolley(runId, code);
      const bag = run.bags.find((b) => b.id === result.bag.id);
      if (bag) bag.status = 'Out for Delivery';
      renderLoadStep(root, result.loadedCount, result.total);
      if (result.loadedCount >= result.total) {
        loadScanInstance?.destroy(); loadScanInstance = null;
        setTimeout(() => { if (appEl) renderRun(); }, 1100);
      }
      return result;
    },
  });
}

function renderNotifyPrompt(root) {
  root.innerHTML = `
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p>All ${run.bags.length} bags are loaded onto ${esc(run.trolleyCode)}.</p>
      <button type="button" class="btn btn-primary" data-action="notify">${icon('send', 16)} Notify delivery team</button>
    </div>`;
  root.querySelector('[data-action="notify"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.notify(runId);
      toast(`${run.lead} and team notified.`, 'success');
      await loadRun();
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      toast(err.message, 'error');
    }
  });
}

function renderSummary(root) {
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div class="card">
        <div class="section-title">Run summary</div>
        <div class="stack gap-2 fs-sm">
          <div class="row" style="justify-content:space-between"><span class="muted">Team</span><strong>${esc(run.team)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Lead</span><strong>${esc(run.lead)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Trolley</span><strong class="mono">${esc(run.trolleyCode)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Bags</span><strong>${run.bags.length}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Notified</span><strong>${run.notifiedAt ? fmtDateTime(run.notifiedAt) : '—'}</strong></div>
          ${run.cancelReason ? `<div class="row" style="justify-content:space-between"><span class="muted">Cancel reason</span><strong>${esc(run.cancelReason)}</strong></div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="section-title">Manifest</div>
        <p class="fs-sm muted">Print a room-by-room manifest for the delivery team.</p>
        <button type="button" class="btn btn-secondary" data-action="print-manifest">${icon('printer', 16)} Print manifest</button>
        <div id="manifest-root" style="margin-block-start:var(--s4)"></div>
      </div>
    </div>`;
  root.querySelector('[data-action="print-manifest"]').addEventListener('click', onPrintManifest);
}

async function onPrintManifest() {
  const root = appEl.querySelector('#manifest-root');
  root.innerHTML = skeletonBlock(3);
  try {
    const m = await api.manifest(runId);
    if (!appEl) return;
    root.innerHTML = `
      <div class="room-receipt no-print-margin">
        <p class="fs-sm"><strong>${esc(m.hotel)}</strong> · Building ${esc(m.building)} · Run ${esc(m.runCode)}</p>
        <p class="fs-xs muted">Team ${esc(m.team)} · Lead ${esc(m.lead)} · Trolley ${esc(m.trolleyCode)} · Generated ${fmtDateTime(m.generatedAt)}</p>
        <table class="data-table" style="margin-block-start:var(--s3);width:100%">
          <thead><tr><th>Room</th><th>Pilgrim</th><th>Nusuk (last 4)</th><th>Tag</th><th>Note</th></tr></thead>
          <tbody>
            ${m.rows.map((r) => `<tr><td>${esc(r.room)}</td><td>${esc(r.pilgrimName)}</td><td class="mono">${esc(r.nusukLast4)}</td><td class="mono">${esc(r.tag)}</td><td>${esc(r.damageNote || '')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    window.print();
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', onPrintManifest);
  }
}

function onCancelRun() {
  let submitting = false;
  const close = openModal({
    title: 'Cancel run',
    bodyHtml: `
      <form id="cancel-run-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Any loaded bags will be returned to Sorted status so they can be replanned.</p>
        <div class="field">
          <label for="cancel-reason">Reason <span class="req">*</span></label>
          <textarea id="cancel-reason" placeholder="Why is this run being cancelled?" required></textarea>
          <div class="error" id="err-cancel-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="dismiss">Back</button>
          <button type="submit" class="btn btn-danger" id="cancel-run-submit">Cancel run</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('cancel-run-form');
  form.querySelector('[data-act="dismiss"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#cancel-reason').value.trim();
    const errBox = form.querySelector('#err-cancel-reason');
    if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#cancel-run-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Cancelling…';
    try {
      await api.cancelAssignment(runId, reason);
      close();
      toast('Run cancelled.', 'info');
      await loadRun();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Cancel run';
      toast(err.message, 'error');
    }
  });
}
