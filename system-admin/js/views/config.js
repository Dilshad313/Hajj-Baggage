import * as api from '../api.js';
import { skeletonBlock, errorState, toast, confirmDialog, esc, icon } from '../ui.js';

let appEl = null;
let config = null;
let alertRules = [];
let roles = [];
let activeTab = 'nusuk';

const TABS = [
  { id: 'nusuk', label: 'Nusuk API' },
  { id: 'airline', label: 'Airline API' },
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'alerts', label: 'Alert rules' },
];

const THRESHOLD_LABELS = {
  maxBagWeightKg: 'Max bag weight', maxBagsPerPilgrim: 'Max bags per pilgrim', slotMinutes: 'Slot length',
  slotCapacity: 'Slot capacity', closeHoursBeforeCutoff: 'Check-in close before cut-off', noShowGraceMinutes: 'No-show grace period',
  airportTransitMinutes: 'Airport transit time', dispatchWarningMinutes: 'Dispatch warning threshold',
  handoverCutoffBufferMinutes: 'Handover cut-off buffer', bsmWeightToleranceKg: 'BSM weight tolerance',
  uldCapacity: 'ULD capacity', trolleyCapacity: 'Trolley capacity', maxDeliveryAttempts: 'Max delivery attempts',
  supervisorPin: 'Supervisor override PIN',
};

const ALERT_CONDITIONS = [
  { value: 'Exception severity ≥', kind: 'severity' },
  { value: 'Truck delay > (min)', kind: 'number', max: 600 },
  { value: 'Cut-off < (min) with bags not loaded', kind: 'number', max: 600 },
  { value: 'Bag stuck at stage > (h)', kind: 'number', max: 72 },
];

let nusukDirty = false;
let airlineDirty = {}; // code -> bool
let thresholdsDirty = false;

export function render(params, app) {
  appEl = app;
  activeTab = 'nusuk';
  nusukDirty = false; airlineDirty = {}; thresholdsDirty = false;
  load();
  return { destroy, poll: refreshQuiet };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageHeader() + skeletonBlock(6);
  try {
    [config, alertRules, roles] = await Promise.all([api.getConfig(), api.getAlertRules(), api.getRoles().then((r) => r.roles)]);
    renderPage();
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || isAnyDirty()) return;
  try {
    [config, alertRules] = await Promise.all([api.getConfig(), api.getAlertRules()]);
    renderPage();
  } catch (e) { /* silent */ }
}

function isAnyDirty() { return nusukDirty || thresholdsDirty || Object.values(airlineDirty).some(Boolean); }

function pageHeader() {
  return `<div class="page-header"><div><h1 class="page-title">System configuration</h1><p class="page-subtitle">Integrations, business thresholds and alert rules.</p></div></div>`;
}

async function switchTab(tabId) {
  if (tabId === activeTab) return;
  const dirtyNow = (activeTab === 'nusuk' && nusukDirty) || (activeTab === 'airline' && Object.values(airlineDirty).some(Boolean)) || (activeTab === 'thresholds' && thresholdsDirty);
  if (dirtyNow) {
    const ok = await confirmDialog({ title: 'Discard unsaved changes?', body: 'You have unsaved configuration changes on this tab.', confirmLabel: 'Discard', danger: true });
    if (!ok) return;
    nusukDirty = false; airlineDirty = {}; thresholdsDirty = false;
  }
  activeTab = tabId;
  renderPage();
}

function renderPage() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${activeTab === t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="config-panel"></div>`;
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  const panel = appEl.querySelector('#config-panel');
  if (activeTab === 'nusuk') renderNusukTab(panel);
  else if (activeTab === 'airline') renderAirlineTab(panel);
  else if (activeTab === 'thresholds') renderThresholdsTab(panel);
  else renderAlertRulesTab(panel);
}

/* ===================== Shared bits ===================== */

function stepLogHtml(steps) {
  return `<div class="step-log">${steps.map((s) => `<span class="${s.ok ? 'ok' : 'fail'}">${s.ok ? '✓' : '✗'} ${esc(s.label)}${s.detail ? ' — ' + esc(s.detail) : ''}</span>`).join('')}</div>`;
}

function saveBarHtml(enabled, hint) {
  return `
    <div class="save-bar">
      <span class="row gap-2 fs-sm"><span class="unsaved-dot"></span> You have unsaved changes${hint ? ` — ${esc(hint)}` : ''}</span>
      <div class="row gap-2">
        <button type="button" class="btn btn-secondary" data-act="discard">Discard</button>
        <button type="button" class="btn btn-primary" data-act="save" ${enabled ? '' : 'disabled'}>Save configuration</button>
      </div>
    </div>`;
}

function bindSecretReveal(container, id) {
  const input = container.querySelector(`#${id}`);
  const btn = container.querySelector(`[data-reveal="${id}"]`);
  if (!input || !btn) return;
  let timer = null;
  btn.addEventListener('click', () => {
    const revealing = input.type === 'password';
    input.type = revealing ? 'text' : 'password';
    btn.textContent = revealing ? 'Hide' : 'Reveal';
    if (timer) { clearTimeout(timer); timer = null; }
    if (revealing) {
      timer = setTimeout(() => { input.type = 'password'; btn.textContent = 'Reveal'; timer = null; }, 10000);
    }
  });
}

/* ===================== Nusuk tab ===================== */

function renderNusukTab(panel) {
  const c = config.nusuk;
  let tested = api.wasTested('nusuk');
  panel.innerHTML = `
    <div class="card" style="max-width:640px">
      <div class="field">
        <label for="nk-baseUrl">Base URL <span class="req">*</span></label>
        <input id="nk-baseUrl" value="${esc(c.baseUrl)}" />
        <div class="error" id="err-nk-baseUrl" hidden></div>
      </div>
      <div class="field">
        <label for="nk-clientId">Client ID <span class="req">*</span></label>
        <input id="nk-clientId" value="${esc(c.clientId)}" />
        <div class="error" id="err-nk-clientId" hidden></div>
      </div>
      <div class="field">
        <label for="nk-clientSecret">Client secret <span class="req">*</span></label>
        <div class="input-group">
          <input id="nk-clientSecret" type="password" value="${esc(c.clientSecret)}" />
          <button type="button" class="reveal-btn" data-reveal="nk-clientSecret">Reveal</button>
        </div>
        <div class="error" id="err-nk-clientSecret" hidden></div>
      </div>
      <div class="field">
        <label for="nk-timeoutSec">Timeout (seconds) <span class="req">*</span></label>
        <input id="nk-timeoutSec" type="number" min="1" max="60" value="${c.timeoutSec}" />
        <div class="error" id="err-nk-timeoutSec" hidden></div>
      </div>
      <div class="field">
        <label for="nk-environment">Environment</label>
        <select id="nk-environment">
          <option value="Sandbox" ${c.environment === 'Sandbox' ? 'selected' : ''}>Sandbox</option>
          <option value="Production" ${c.environment === 'Production' ? 'selected' : ''}>Production</option>
        </select>
      </div>
      <p class="fs-xs muted">Last tested: ${c.lastTestAt ? esc(new Date(c.lastTestAt).toLocaleString()) : 'never'} · ${c.lastTestOk ? 'OK' : 'not confirmed'}</p>
      <button type="button" class="btn btn-secondary" data-act="test">${icon('plug-zap', 16)} Test connection</button>
      <div id="nk-steplog"></div>
      <p class="fs-xs muted" id="nk-test-hint" ${tested ? 'hidden' : ''} style="margin-block-start:var(--s2)">Test the connection before saving.</p>
    </div>
    <div id="nk-savebar"></div>`;

  bindSecretReveal(panel, 'nk-clientSecret');

  function markDirty() { nusukDirty = true; renderSaveBar(); }
  ['nk-baseUrl', 'nk-clientId', 'nk-clientSecret', 'nk-timeoutSec', 'nk-environment'].forEach((id) => {
    panel.querySelector(`#${id}`).addEventListener('input', markDirty);
    panel.querySelector(`#${id}`).addEventListener('change', markDirty);
  });

  function renderSaveBar() {
    panel.querySelector('#nk-savebar').innerHTML = nusukDirty ? saveBarHtml(tested, tested ? '' : 'test the connection to enable saving') : '';
    panel.querySelector('[data-act="discard"]')?.addEventListener('click', () => renderNusukTab(panel));
    panel.querySelector('[data-act="save"]')?.addEventListener('click', saveNusuk);
  }

  panel.querySelector('[data-act="test"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    const secret = panel.querySelector('#nk-clientSecret').value;
    try {
      const result = await api.testConnection('nusuk', { clientSecret: secret });
      panel.querySelector('#nk-steplog').innerHTML = stepLogHtml(result.steps);
      tested = result.ok;
      panel.querySelector('#nk-test-hint').hidden = tested;
      if (result.ok) toast('Connection succeeded.', 'success');
      else toast('Connection failed — see details below.', 'error');
      renderSaveBar();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  async function saveNusuk() {
    const baseUrl = panel.querySelector('#nk-baseUrl').value.trim();
    const clientId = panel.querySelector('#nk-clientId').value.trim();
    const clientSecret = panel.querySelector('#nk-clientSecret').value.trim();
    const timeoutSec = Number(panel.querySelector('#nk-timeoutSec').value);
    const environment = panel.querySelector('#nk-environment').value;
    let valid = true;
    const setErr = (id, msg) => { const el = panel.querySelector(`#err-${id}`); const input = panel.querySelector(`#${id}`); if (msg) { el.textContent = msg; el.hidden = false; input.setAttribute('aria-invalid', 'true'); valid = false; } else { el.hidden = true; input.removeAttribute('aria-invalid'); } };
    setErr('nk-baseUrl', /^https:\/\/.+/.test(baseUrl) ? '' : 'Base URL must start with https://.');
    setErr('nk-clientId', clientId ? '' : 'Client ID is required.');
    setErr('nk-clientSecret', clientSecret ? '' : 'Client secret is required.');
    setErr('nk-timeoutSec', timeoutSec >= 1 && timeoutSec <= 60 ? '' : 'Timeout must be between 1 and 60 seconds.');
    if (!valid) return;
    const btn = panel.querySelector('[data-act="save"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      config.nusuk = await api.saveNusukConfig({ baseUrl, clientId, clientSecret, timeoutSec, environment });
      nusukDirty = false;
      toast('Nusuk API configuration saved.', 'success');
      renderNusukTab(panel);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  }

  renderSaveBar();
}

/* ===================== Airline tab ===================== */

function renderAirlineTab(panel) {
  panel.innerHTML = `<div class="stack gap-4">${config.airlines.map((a) => airlineCardHtml(a)).join('')}</div>`;
  config.airlines.forEach((a) => wireAirlineCard(panel, a.code));
}

function airlineCardHtml(a) {
  return `
    <div class="card" data-airline-card="${esc(a.code)}">
      <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
        <h2 class="section-title" style="margin:0">${esc(a.name)} <span class="mono fs-sm muted">${esc(a.code)}</span></h2>
        ${a.lastTestOk === false ? `<span class="chip chip-red">Last test failed</span>` : a.lastTestOk ? `<span class="chip chip-green">Connected</span>` : `<span class="chip chip-grey">Not tested</span>`}
      </div>
      <div class="grid grid-cols-2">
        <div class="field">
          <label for="al-endpoint-${esc(a.code)}">Endpoint <span class="req">*</span></label>
          <input id="al-endpoint-${esc(a.code)}" value="${esc(a.endpoint)}" />
          <div class="error" id="err-al-endpoint-${esc(a.code)}" hidden></div>
        </div>
        <div class="field">
          <label for="al-apiKey-${esc(a.code)}">API key <span class="req">*</span></label>
          <div class="input-group">
            <input id="al-apiKey-${esc(a.code)}" type="password" value="${esc(a.apiKey)}" />
            <button type="button" class="reveal-btn" data-reveal="al-apiKey-${esc(a.code)}">Reveal</button>
          </div>
          <div class="error" id="err-al-apiKey-${esc(a.code)}" hidden></div>
        </div>
        <div class="field">
          <label for="al-format-${esc(a.code)}">Message format</label>
          <select id="al-format-${esc(a.code)}">
            <option value="IATA Type B" ${a.format === 'IATA Type B' ? 'selected' : ''}>IATA Type B</option>
            <option value="JSON" ${a.format === 'JSON' ? 'selected' : ''}>JSON</option>
          </select>
        </div>
        <div class="field">
          <label class="checkbox-row" for="al-bsm-${esc(a.code)}" style="margin-block-start:var(--s5)">
            <input id="al-bsm-${esc(a.code)}" type="checkbox" ${a.bsmFeed ? 'checked' : ''} /> BSM feed enabled
          </label>
        </div>
      </div>
      <p class="fs-xs muted">Last tested: ${a.lastTestAt ? esc(new Date(a.lastTestAt).toLocaleString()) : 'never'}</p>
      <button type="button" class="btn btn-secondary" data-act="test" data-code="${esc(a.code)}">${icon('plug-zap', 16)} Test connection</button>
      <div id="al-steplog-${esc(a.code)}"></div>
      <p class="fs-xs muted" id="al-test-hint-${esc(a.code)}" ${api.wasTested(a.code) ? 'hidden' : ''} style="margin-block-start:var(--s2)">Test the connection before saving.</p>
      <div id="al-savebar-${esc(a.code)}"></div>
    </div>`;
}

function wireAirlineCard(panel, code) {
  const card = panel.querySelector(`[data-airline-card="${code}"]`);
  bindSecretReveal(card, `al-apiKey-${code}`);
  let tested = api.wasTested(code);

  function markDirty() { airlineDirty[code] = true; renderSaveBar(); }
  ['endpoint', 'apiKey', 'format', 'bsm'].forEach((f) => {
    card.querySelector(`#al-${f}-${code}`).addEventListener('input', markDirty);
    card.querySelector(`#al-${f}-${code}`).addEventListener('change', markDirty);
  });

  function renderSaveBar() {
    card.querySelector(`#al-savebar-${code}`).innerHTML = airlineDirty[code] ? saveBarHtml(tested, tested ? '' : 'test the connection to enable saving') : '';
    card.querySelector('[data-act="discard"]')?.addEventListener('click', () => {
      airlineDirty[code] = false;
      renderAirlineTab(panel);
    });
    card.querySelector('[data-act="save"]')?.addEventListener('click', () => saveAirline(code, card));
  }

  card.querySelector('[data-act="test"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    const apiKey = card.querySelector(`#al-apiKey-${code}`).value;
    try {
      const result = await api.testConnection(code, { apiKey });
      card.querySelector(`#al-steplog-${code}`).innerHTML = stepLogHtml(result.steps);
      tested = result.ok;
      card.querySelector(`#al-test-hint-${code}`).hidden = tested;
      toast(result.ok ? 'Connection succeeded.' : 'Connection failed — see details below.', result.ok ? 'success' : 'error');
      renderSaveBar();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  renderSaveBar();
}

async function saveAirline(code, card) {
  const endpoint = card.querySelector(`#al-endpoint-${code}`).value.trim();
  const apiKey = card.querySelector(`#al-apiKey-${code}`).value.trim();
  const format = card.querySelector(`#al-format-${code}`).value;
  const bsmFeed = card.querySelector(`#al-bsm-${code}`).checked;
  let valid = true;
  const setErr = (id, msg) => { const el = card.querySelector(`#err-${id}`); if (!el) return; if (msg) { el.textContent = msg; el.hidden = false; valid = false; } else el.hidden = true; };
  setErr(`al-endpoint-${code}`, /^https:\/\/.+/.test(endpoint) ? '' : 'Endpoint must start with https://.');
  setErr(`al-apiKey-${code}`, apiKey ? '' : 'API key is required.');
  if (!valid) return;
  const btn = card.querySelector('[data-act="save"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const updated = await api.saveAirlineConfig(code, { endpoint, apiKey, format, bsmFeed });
    const idx = config.airlines.findIndex((a) => a.code === code);
    if (idx >= 0) config.airlines[idx] = updated;
    airlineDirty[code] = false;
    toast(`${updated.name} configuration saved.`, 'success');
    renderAirlineTab(card.closest('#config-panel'));
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

/* ===================== Thresholds tab ===================== */

function renderThresholdsTab(panel) {
  const t = config.thresholds;
  panel.innerHTML = `
    <div class="grid grid-cols-2">
      ${Object.entries(t).map(([key, cfg]) => `
        <div class="field">
          <label for="th-${esc(key)}">${esc(THRESHOLD_LABELS[key] || key)} <span class="req">*</span></label>
          ${key === 'supervisorPin' ? `
            <div class="input-group">
              <input id="th-${esc(key)}" type="password" value="${esc(cfg.value)}" />
              <button type="button" class="reveal-btn" data-reveal="th-${esc(key)}">Reveal</button>
            </div>` : `<input id="th-${esc(key)}" type="number" min="${cfg.min ?? ''}" max="${cfg.max ?? ''}" step="any" value="${esc(cfg.value)}" />`}
          <div class="hint">${esc(cfg.help)}${cfg.min != null ? ` Range ${cfg.min}–${cfg.max} ${esc(cfg.unit)}.` : ''}</div>
          ${cfg.liveImpact ? `<div class="hint" style="color:var(--warning)">${icon('alert-triangle', 14)} Changing this affects live operations immediately.</div>` : ''}
          <div class="error" id="err-th-${esc(key)}" hidden></div>
        </div>`).join('')}
    </div>
    <div id="th-savebar"></div>`;

  bindSecretReveal(panel, 'th-supervisorPin');

  Object.keys(t).forEach((key) => {
    panel.querySelector(`#th-${key}`).addEventListener('input', () => { thresholdsDirty = true; renderSaveBar(); });
  });

  function renderSaveBar() {
    panel.querySelector('#th-savebar').innerHTML = thresholdsDirty ? saveBarHtml(true) : '';
    panel.querySelector('[data-act="discard"]')?.addEventListener('click', () => { thresholdsDirty = false; renderThresholdsTab(panel); });
    panel.querySelector('[data-act="save"]')?.addEventListener('click', saveThresholds);
  }

  async function saveThresholds() {
    const payload = {};
    let valid = true;
    for (const [key, cfg] of Object.entries(t)) {
      const input = panel.querySelector(`#th-${key}`);
      const errEl = panel.querySelector(`#err-th-${key}`);
      let val;
      if (key === 'supervisorPin') {
        val = input.value.trim();
        if (!/^\d{4}$/.test(val)) { errEl.textContent = 'PIN must be exactly 4 digits.'; errEl.hidden = false; valid = false; } else errEl.hidden = true;
      } else {
        val = Number(input.value);
        if (Number.isNaN(val) || val < cfg.min || val > cfg.max) { errEl.textContent = `Must be between ${cfg.min} and ${cfg.max} ${cfg.unit}.`; errEl.hidden = false; valid = false; } else errEl.hidden = true;
      }
      payload[key] = val;
    }
    if (!valid) return;
    const btn = panel.querySelector('[data-act="save"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      config.thresholds = await api.saveThresholds(payload);
      thresholdsDirty = false;
      toast('Thresholds saved.', 'success');
      renderThresholdsTab(panel);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  }

  renderSaveBar();
}

/* ===================== Alert rules tab ===================== */

function renderAlertRulesTab(panel) {
  panel.innerHTML = `
    <div class="page-header" style="margin-block-end:var(--s4)">
      <p class="muted fs-sm">Notify roles when operational conditions are met.</p>
      <button type="button" class="btn btn-secondary" data-act="add-rule">${icon('plus', 16)} Add rule</button>
    </div>
    <div id="rules-list">${alertRules.map((r) => ruleRowHtml(r)).join('') || `<p class="muted fs-sm">No alert rules configured yet.</p>`}</div>`;

  panel.querySelector('[data-act="add-rule"]').addEventListener('click', () => {
    alertRules.push({ id: null, condition: ALERT_CONDITIONS[0].value, threshold: '', notifyRoles: [], channel: 'In-app', active: true, _new: true });
    renderAlertRulesTab(panel);
  });

  alertRules.forEach((r, i) => wireRuleRow(panel, r, i));
}

function ruleRowHtml(rule) {
  const kind = ALERT_CONDITIONS.find((c) => c.value === rule.condition)?.kind || 'number';
  return `
    <div class="rule-row">
      <div class="field" style="margin:0">
        <label>Condition</label>
        <select data-f="condition">
          ${ALERT_CONDITIONS.map((c) => `<option value="${esc(c.value)}" ${rule.condition === c.value ? 'selected' : ''}>${esc(c.value)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0">
        <label>Threshold</label>
        ${kind === 'severity'
          ? `<select data-f="threshold">${['Low', 'Medium', 'High', 'Critical'].map((s) => `<option value="${s}" ${rule.threshold === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`
          : `<input type="number" min="1" data-f="threshold" value="${esc(rule.threshold)}" />`}
      </div>
      <div class="field" style="margin:0">
        <label>Notify roles</label>
        <select data-f="notifyRoles" multiple size="3">
          ${roles.map((r) => `<option value="${esc(r.id)}" ${rule.notifyRoles.includes(r.id) ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0">
        <label>Channel</label>
        <select data-f="channel">
          ${['In-app', 'SMS', 'Email'].map((c) => `<option value="${c}" ${rule.channel === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <label class="checkbox-row" style="margin-block-start:var(--s2)"><input type="checkbox" data-f="active" ${rule.active ? 'checked' : ''} /> Active</label>
      </div>
      <div class="row gap-1">
        <button type="button" class="btn btn-secondary btn-icon" data-act="save-rule" aria-label="Save rule">${icon('check', 16)}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="delete-rule" aria-label="Delete rule">${icon('trash-2', 16)}</button>
      </div>
    </div>`;
}

function wireRuleRow(panel, rule, index) {
  const row = panel.querySelectorAll('.rule-row')[index];
  if (!row) return;
  row.querySelector('[data-f="condition"]').addEventListener('change', (e) => {
    rule.condition = e.target.value;
    rule.threshold = '';
    renderAlertRulesTab(panel);
  });
  row.querySelector('[data-act="save-rule"]').addEventListener('click', async () => {
    const threshold = row.querySelector('[data-f="threshold"]').value;
    const notifyRoles = Array.from(row.querySelector('[data-f="notifyRoles"]').selectedOptions).map((o) => o.value);
    const channel = row.querySelector('[data-f="channel"]').value;
    const active = row.querySelector('[data-f="active"]').checked;
    if (threshold === '' || threshold == null) { toast('A threshold value is required.', 'error'); return; }
    const condDef = ALERT_CONDITIONS.find((c) => c.value === rule.condition);
    if (condDef?.kind === 'number') {
      const n = Number(threshold);
      if (Number.isNaN(n) || n < 1 || n > condDef.max) { toast(`Threshold must be between 1 and ${condDef.max}.`, 'error'); return; }
    }
    if (!notifyRoles.length) { toast('Select at least one role to notify.', 'error'); return; }
    const dup = alertRules.some((r) => r !== rule && r.condition === rule.condition && String(r.threshold) === String(threshold));
    if (dup) toast('A similar rule already exists — saved anyway.', 'info');
    try {
      const saved = await api.saveAlertRule({ id: rule.id, condition: rule.condition, threshold, notifyRoles, channel, active });
      alertRules = saved;
      toast('Alert rule saved.', 'success');
      renderAlertRulesTab(panel);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  row.querySelector('[data-act="delete-rule"]').addEventListener('click', async () => {
    if (!rule.id) { alertRules.splice(index, 1); renderAlertRulesTab(panel); return; }
    const ok = await confirmDialog({ title: 'Delete this alert rule?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      alertRules = await api.deleteAlertRule(rule.id);
      toast('Alert rule deleted.', 'success');
      renderAlertRulesTab(panel);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
