import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, confirmDialog } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let scanCtl = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy };
}

export function destroy() { scanCtl?.destroy(); scanCtl = null; appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderScreen(trip) {
  if (trip.seal.confirmedByDriver) { renderConfirmed(trip); return; }

  if (!trip.seal.number) {
    appEl.innerHTML = `
      <div class="page-header"><div><h1 class="page-title">Seal the truck</h1></div></div>
      <div class="card" style="margin-block-end:var(--s5)">
        <div class="field">
          <label for="seal-number-input">Seal number</label>
          <input id="seal-number-input" class="mono" placeholder="SL-XXXXXX" value="" />
          <div class="hint">Format SL- followed by 6 letters/numbers, or leave blank to generate one.</div>
        </div>
        <button type="button" class="btn btn-secondary" data-action="generate">${icon('lock', 16)} Generate seal</button>
      </div>`;
    appEl.querySelector('[data-action="generate"]').addEventListener('click', async () => {
      try {
        await api.seal(tripId, { number: appEl.querySelector('#seal-number-input').value.trim() || undefined });
        toast('Seal recorded.', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
    return;
  }

  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Confirm seal</h1></div></div>
    <div class="seal-display">${icon('lock', 28)}<span class="seal-number">${esc(trip.seal.number)}</span></div>
    <p class="fs-sm muted" style="text-align:center;margin-block-end:var(--s5)">
      ${trip.seal.sealedBy === 'driver' ? 'Scan the seal you just applied to confirm it.' : `Sealed by ${trip.seal.sealedBy === 'warehouse' ? 'the warehouse' : 'the ground handler'} — scan to confirm.`}
    </p>
    <div id="seal-scan-root"></div>`;

  scanCtl = createScanInput(appEl.querySelector('#seal-scan-root'), {
    label: 'Scan the seal',
    placeholder: 'Scan or type the seal number',
    onSubmit: async (code) => {
      await api.confirmSeal(tripId, code);
      toast('Seal confirmed.', 'success');
      setTimeout(() => load(), 700);
      return { message: 'Seal confirmed.' };
    },
  });
}

function renderConfirmed(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Confirm seal</h1></div></div>
    <div class="seal-display">${icon('lock', 28)}<span class="seal-number">${esc(trip.seal.number)}</span></div>
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">Seal confirmed.</p>
      <button type="button" class="btn btn-primary btn-lg" data-action="start">${icon('play', 18)} Start trip</button>
    </div>`;
  appEl.querySelector('[data-action="start"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Start trip',
      body: `Start trip with ${trip.count.expected} bags, seal ${trip.seal.number}?`,
      confirmLabel: 'Start trip',
    });
    if (!ok) return;
    try {
      await api.startTrip(tripId);
      toast('Trip started.', 'success');
      navigate('#/map');
    } catch (err) { toast(err.message, 'error'); }
  });
}
