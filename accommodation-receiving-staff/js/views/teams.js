import * as api from '../api.js';
import {
  esc, icon, toast, skeletonBlock, emptyState, errorState,
  openModal, confirmDialog,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let activeTab = 'teams'; // 'teams' | 'trolleys'

let teams = null;
let teamsError = '';

let trolleys = null;
let trolleysError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  activeTab = 'teams';
  teams = null; teamsError = '';
  trolleys = null; trolleysError = '';
  renderPage();
  loadTeams();
  return { destroy };
}

export function destroy() {
  appEl = null;
}

/* ===================== shell / tabs ===================== */

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Teams &amp; trolleys</h1>
        <p class="page-subtitle">Manage delivery teams and the trolley fleet for this hotel.</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="new">${icon('plus', 16)} New ${activeTab === 'teams' ? 'team' : 'trolley'}</button>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-teams" aria-selected="${activeTab === 'teams'}" data-tab="teams">Teams</button>
      <button type="button" class="tab" role="tab" id="tab-trolleys" aria-selected="${activeTab === 'trolleys'}" data-tab="trolleys">Trolleys</button>
    </div>
    <div id="tab-content"></div>`;

  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => onTabClick(btn.dataset.tab)));
  appEl.querySelector('[data-action="new"]').addEventListener('click', () => {
    if (activeTab === 'teams') openTeamModal(null);
    else openTrolleyModal();
  });
  renderActiveTabContent();
}

function onTabClick(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  renderPage();
  if (tab === 'teams' && teams === null && !teamsError) loadTeams();
  if (tab === 'trolleys' && trolleys === null && !trolleysError) loadTrolleys();
}

function renderActiveTabContent() {
  const root = appEl?.querySelector('#tab-content');
  if (!root) return;
  if (activeTab === 'teams') renderTeamsContent(root);
  else renderTrolleysContent(root);
}

/* ===================== Teams tab ===================== */

async function loadTeams() {
  if (!appEl) return;
  teams = null;
  teamsError = '';
  if (activeTab === 'teams') renderActiveTabContent();
  try {
    const result = await api.getTeams();
    if (!appEl) return;
    teams = result;
    if (activeTab === 'teams') renderActiveTabContent();
  } catch (err) {
    if (!appEl) return;
    teamsError = err.message;
    teams = null;
    if (activeTab === 'teams') renderActiveTabContent();
  }
}

function renderTeamsContent(root) {
  if (teamsError) {
    root.innerHTML = errorState({ message: teamsError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadTeams);
    return;
  }
  if (teams === null) {
    root.innerHTML = skeletonBlock(4);
    return;
  }
  if (!teams.length) {
    root.innerHTML = emptyState({
      message: 'No teams yet. Add a team to start planning deliveries.',
      actionLabel: 'New team',
      actionAttr: 'data-action="new-team-empty"',
    });
    root.querySelector('[data-action="new-team-empty"]')?.addEventListener('click', () => openTeamModal(null));
    return;
  }
  root.innerHTML = `<div class="grid grid-auto">${teams.map(renderTeamCard).join('')}</div>`;
  root.querySelectorAll('[data-action="edit-team"]').forEach((btn) => {
    btn.addEventListener('click', () => openTeamModal(teams.find((t) => t.id === btn.dataset.id) || null));
  });
  root.querySelectorAll('[data-action="toggle-team"]').forEach((btn) => btn.addEventListener('click', () => onToggleTeam(btn)));
}

function renderTeamCard(t) {
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:var(--s2)">
        <div>
          <strong>${esc(t.name)}</strong>
          <div class="fs-sm muted">Building ${esc(t.building)}</div>
        </div>
        ${statusChip(t.active ? 'Active' : 'Inactive')}
      </div>
      <div class="fs-sm" style="margin-block:var(--s2)"><span class="muted">Lead</span> ${esc(t.leadName)}</div>
      <div class="fs-sm muted">${esc(t.memberNames.join(', '))}</div>
      <div class="row gap-2" style="margin-block-start:var(--s4)">
        <button type="button" class="btn btn-secondary" data-action="edit-team" data-id="${esc(t.id)}">${icon('pencil', 14)} Edit</button>
        <button type="button" class="btn btn-ghost" data-action="toggle-team" data-id="${esc(t.id)}">
          ${t.active ? icon('user-x', 14) + ' Deactivate' : icon('user-check', 14) + ' Reactivate'}
        </button>
      </div>
    </div>`;
}

async function onToggleTeam(btn) {
  const team = teams.find((t) => t.id === btn.dataset.id);
  if (!team) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.toggleTeamActive(team.id, !team.active);
    toast(`${team.name} ${team.active ? 'deactivated' : 'reactivated'}.`, 'success');
    await loadTeams();
  } catch (err) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function openTeamModal(team) {
  const isEdit = !!team;
  let submitting = false;
  const close = openModal({
    title: isEdit ? `Edit ${team.name}` : 'New team',
    bodyHtml: `
      <form id="team-form" novalidate>
        <div class="field">
          <label for="team-name">Team name <span class="req">*</span></label>
          <input id="team-name" type="text" value="${esc(team?.name || '')}" required />
          <div class="error" id="err-team-name" hidden></div>
        </div>
        <div class="field">
          <label for="team-building">Building</label>
          <input id="team-building" type="text" value="${esc(team?.building || '')}" placeholder="e.g. A" />
        </div>
        <div class="field">
          <label for="team-members">Members <span class="req">*</span></label>
          <textarea id="team-members" placeholder="One name per line, or comma-separated">${esc((team?.memberNames || []).join('\n'))}</textarea>
          <div class="hint">The first member listed becomes the team lead.</div>
          <div class="error" id="err-team-members" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="team-submit">${isEdit ? 'Save changes' : 'Create team'}</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('team-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const name = form.querySelector('#team-name').value.trim();
    const building = form.querySelector('#team-building').value.trim();
    const memberNames = form.querySelector('#team-members').value.split(/[,\n]/).map((m) => m.trim()).filter(Boolean);
    const errName = form.querySelector('#err-team-name');
    const errMembers = form.querySelector('#err-team-members');
    let hasError = false;
    if (!name) { errName.textContent = 'Team name is required.'; errName.hidden = false; hasError = true; } else errName.hidden = true;
    if (!memberNames.length) { errMembers.textContent = 'At least one member is required.'; errMembers.hidden = false; hasError = true; } else errMembers.hidden = true;
    if (hasError) return;
    submitting = true;
    const btn = form.querySelector('#team-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = isEdit ? 'Saving…' : 'Creating…';
    try {
      if (isEdit) await api.updateTeam(team.id, { name, building, memberNames });
      else await api.createTeam({ name, building, memberNames });
      close();
      toast(isEdit ? 'Team updated.' : 'Team created.', 'success');
      await loadTeams();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = isEdit ? 'Save changes' : 'Create team';
      toast(err.message, 'error');
    }
  });
}

/* ===================== Trolleys tab ===================== */

async function loadTrolleys() {
  if (!appEl) return;
  trolleys = null;
  trolleysError = '';
  if (activeTab === 'trolleys') renderActiveTabContent();
  try {
    const result = await api.getTrolleys();
    if (!appEl) return;
    trolleys = result;
    if (activeTab === 'trolleys') renderActiveTabContent();
  } catch (err) {
    if (!appEl) return;
    trolleysError = err.message;
    trolleys = null;
    if (activeTab === 'trolleys') renderActiveTabContent();
  }
}

function renderTrolleysContent(root) {
  if (trolleysError) {
    root.innerHTML = errorState({ message: trolleysError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadTrolleys);
    return;
  }
  if (trolleys === null) {
    root.innerHTML = skeletonBlock(4);
    return;
  }
  if (!trolleys.length) {
    root.innerHTML = emptyState({
      message: 'No trolleys yet. Add one to start assigning delivery runs.',
      actionLabel: 'New trolley',
      actionAttr: 'data-action="new-trolley-empty"',
    });
    root.querySelector('[data-action="new-trolley-empty"]')?.addEventListener('click', openTrolleyModal);
    return;
  }
  root.innerHTML = `<div class="grid grid-auto">${trolleys.map(renderTrolleyCard).join('')}</div>`;
  root.querySelectorAll('[data-action="set-oos"]').forEach((btn) => btn.addEventListener('click', () => openOutOfServiceModal(btn.dataset.id)));
  root.querySelectorAll('[data-action="set-available"]').forEach((btn) => btn.addEventListener('click', () => onSetAvailable(btn)));
}

function renderTrolleyCard(t) {
  const isOut = t.status === 'Out of service';
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:var(--s2)">
        <div>
          <strong class="mono">${esc(t.code)}</strong>
          <div class="fs-sm muted">Capacity ${t.capacity}</div>
        </div>
        ${statusChip(t.status)}
      </div>
      ${isOut && t.outOfServiceReason ? `<div class="fs-sm muted" style="margin-block-start:var(--s2)">${esc(t.outOfServiceReason)}</div>` : ''}
      <div class="row gap-2" style="margin-block-start:var(--s4)">
        ${isOut
          ? `<button type="button" class="btn btn-secondary" data-action="set-available" data-id="${esc(t.id)}">${icon('check', 14)} Set available</button>`
          : `<button type="button" class="btn btn-ghost" data-action="set-oos" data-id="${esc(t.id)}">${icon('alert-triangle', 14)} Set out of service</button>`}
      </div>
    </div>`;
}

async function onSetAvailable(btn) {
  const trolley = trolleys.find((t) => t.id === btn.dataset.id);
  if (!trolley) return;
  const proceed = await confirmDialog({
    title: 'Set trolley available',
    body: `${trolley.code} will be marked available for new delivery runs.`,
    confirmLabel: 'Set available',
  });
  if (!proceed) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.setTrolleyAvailable(trolley.id);
    toast(`${trolley.code} is now available.`, 'success');
    await loadTrolleys();
  } catch (err) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function openOutOfServiceModal(id) {
  const trolley = trolleys.find((t) => t.id === id);
  if (!trolley) return;
  let submitting = false;
  const close = openModal({
    title: `Set ${trolley.code} out of service`,
    bodyHtml: `
      <form id="oos-form" novalidate>
        <div class="field">
          <label for="oos-reason">Reason <span class="req">*</span></label>
          <textarea id="oos-reason" placeholder="Why is this trolley out of service?" required></textarea>
          <div class="error" id="err-oos-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="oos-submit">Set out of service</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('oos-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#oos-reason').value.trim();
    const errBox = form.querySelector('#err-oos-reason');
    if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#oos-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.setTrolleyOutOfService(trolley.id, reason);
      close();
      toast(`${trolley.code} set out of service.`, 'info');
      await loadTrolleys();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Set out of service';
      toast(err.message, 'error');
    }
  });
}

function openTrolleyModal() {
  let submitting = false;
  const close = openModal({
    title: 'New trolley',
    bodyHtml: `
      <form id="trolley-form" novalidate>
        <div class="field">
          <label for="trolley-code">Trolley code <span class="req">*</span></label>
          <input id="trolley-code" type="text" placeholder="TR-SAFWA-05" required />
          <div class="hint">Format TR-[HOTEL]-00, e.g. TR-SAFWA-05.</div>
          <div class="error" id="err-trolley-code" hidden></div>
        </div>
        <div class="field">
          <label for="trolley-capacity">Capacity <span class="req">*</span></label>
          <input id="trolley-capacity" type="number" min="1" max="40" placeholder="e.g. 12" required />
          <div class="error" id="err-trolley-capacity" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="trolley-submit">Create trolley</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('trolley-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const code = form.querySelector('#trolley-code').value.trim();
    const capacityRaw = form.querySelector('#trolley-capacity').value;
    const capacity = Number(capacityRaw);
    const errCode = form.querySelector('#err-trolley-code');
    const errCap = form.querySelector('#err-trolley-capacity');
    let hasError = false;
    if (!/^TR-[A-Za-z]+-\d{2}$/.test(code)) {
      errCode.textContent = 'Trolley number must match TR-[HOTEL]-00.'; errCode.hidden = false; hasError = true;
    } else errCode.hidden = true;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 40) {
      errCap.textContent = 'Capacity must be an integer 1–40.'; errCap.hidden = false; hasError = true;
    } else errCap.hidden = true;
    if (hasError) return;
    submitting = true;
    const btn = form.querySelector('#trolley-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Creating…';
    try {
      await api.createTrolley({ code, capacity });
      close();
      toast('Trolley created.', 'success');
      await loadTrolleys();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Create trolley';
      toast(err.message, 'error');
    }
  });
}
