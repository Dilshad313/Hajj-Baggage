import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtWeight } from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { navigate } from '../router.js';

const HANDOVER_TARGETS = ['Next shift (unspecified)', 'Omar', 'Yusuf', 'Bilal', 'Khalid (Supervisor)'];

let appEl = null;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const data = await api.getHandoverSummary();
    if (!appEl) return;
    renderData(data);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderData(data) {
  const s = data.summary;
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Shift handover</h1></div></div>

    ${data.blocked ? `<div class="result-card danger">${icon('triangle-alert', 20)} You have a check-in in progress. <a href="#/checkin">Complete it</a> before handing over.</div>` : ''}

    <div class="kpi-grid">
      ${kpiTile({ label: 'Pilgrims checked in', value: s.pilgrims })}
      ${kpiTile({ label: 'Bags', value: s.bags })}
      ${kpiTile({ label: 'Total kg', value: fmtWeight(s.totalKg) })}
      ${kpiTile({ label: 'Overweight events', value: s.overweightEvents })}
      ${kpiTile({ label: 'Open exceptions', value: s.exceptions })}
      ${kpiTile({ label: 'Trucks loaded', value: s.trucksLoaded })}
      ${kpiTile({ label: 'Bags awaiting truck', value: s.awaitingTruck })}
      ${kpiTile({ label: 'Open sessions', value: s.openSessions })}
    </div>

    <div class="card" style="max-width:640px">
      <div class="field">
        <label for="handover-notes">Handover notes <span class="req">*</span></label>
        <textarea id="handover-notes" maxlength="1000" placeholder="Anything the next shift should know (10–1000 characters)"></textarea>
        <div class="error" id="err-notes" hidden></div>
      </div>
      <div class="field">
        <label for="handover-to">Hand over to <span class="req">*</span></label>
        <select id="handover-to"><option value="">Select…</option>${HANDOVER_TARGETS.map((h) => `<option>${esc(h)}</option>`).join('')}</select>
        <div class="error" id="err-to" hidden></div>
      </div>
      ${s.awaitingTruck > 0 ? `
        <label class="checkbox-row">
          <input type="checkbox" id="informed-tick" />
          I have informed the next shift about bags still awaiting the truck
        </label>
        <div class="error" id="err-informed" hidden style="margin-block-end:var(--s3)"></div>` : ''}
      <button type="button" class="btn btn-primary btn-lg btn-block" id="submit-handover" ${data.blocked ? 'disabled' : ''}>${icon('clipboard-check', 18)} Submit handover &amp; end shift</button>
    </div>`;

  appEl.querySelector('#submit-handover').addEventListener('click', async () => {
    const notes = appEl.querySelector('#handover-notes').value;
    const handoverTo = appEl.querySelector('#handover-to').value;
    const informed = appEl.querySelector('#informed-tick')?.checked ?? true;
    let valid = true;
    const setErr = (field, msg) => {
      const el = appEl.querySelector(`#err-${field}`);
      if (!el) return;
      if (msg) { el.textContent = msg; el.hidden = false; valid = false; } else el.hidden = true;
    };
    setErr('notes', notes.trim().length < 10 || notes.trim().length > 1000 ? 'Notes must be 10–1000 characters.' : '');
    setErr('to', handoverTo ? '' : 'Select who you are handing over to.');
    setErr('informed', s.awaitingTruck > 0 && !informed ? 'Confirm you have informed the next shift.' : '');
    if (!valid) return;
    try {
      await api.submitHandover({ notes, handoverTo, informedNextShift: informed });
      toast('Handover submitted. Shift ended.', 'success');
      api.logout();
      navigate('#/login');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
