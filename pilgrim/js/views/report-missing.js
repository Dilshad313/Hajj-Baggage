import * as api from '../api.js';
import { toast, esc, fmtWeight, skeletonBlock, emptyState, errorState, announce } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;
let mounted = false;
let bags = [];
let loading = true;
let loadError = '';
let submitting = false;
let selected = new Set();

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  bags = [];
  loading = true;
  loadError = '';
  submitting = false;
  selected = new Set();
  renderShell();
  load();
  return { destroy };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true;
  loadError = '';
  renderShell();
  try {
    const list = await api.getBags('arrival');
    if (!mounted) return;
    bags = list;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Report a missing bag</h1>
      <p class="page-subtitle">Tell us which bag is missing and how to reach you.</p>
    </div>
    <div id="report-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(5);
  if (loadError) return errorState({ message: loadError });
  const available = bags.filter((b) => !b.exception);
  if (!available.length) {
    return emptyState({
      message: bags.length ? 'All your bags are already being tracked.' : 'No arrival bags to report.',
      actionLabel: 'Back to arrival',
      actionAttr: 'data-action="go-arrival"',
    });
  }
  return formHtml();
}

function formHtml() {
  return `
    <form id="report-form" novalidate>
      <div class="field">
        <label>Which bag(s) are missing? <span class="req">*</span></label>
        <div class="stack gap-2">
          ${bags.map((b) => bagRowHtml(b)).join('')}
        </div>
        <div class="error" id="err-bags" hidden></div>
      </div>
      <div class="field">
        <label for="description">Describe the bag and what happened <span class="req">*</span></label>
        <textarea id="description" name="description" maxlength="500" placeholder="e.g. Black hard-shell suitcase with a red ribbon, last seen at baggage claim."></textarea>
        <div class="hint"><span id="desc-count">0</span>/500 characters (minimum 10)</div>
        <div class="error" id="err-description" hidden></div>
      </div>
      <div class="field">
        <label for="phone">Contact phone number <span class="req">*</span></label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="+966501234567" />
        <div class="hint">e.g. +966501234567</div>
        <div class="error" id="err-phone" hidden></div>
      </div>
      <div class="footer-bar">
        <a class="btn btn-secondary" href="#/arrival">Cancel</a>
        <button type="submit" class="btn btn-primary" id="submit-btn"><span class="label">Submit report</span></button>
      </div>
    </form>`;
}

function bagRowHtml(b) {
  const disabled = !!b.exception;
  const checked = selected.has(b.id);
  return `
    <label class="checkbox-row" ${disabled ? 'style="opacity:.6"' : ''}>
      <input type="checkbox" data-bag-id="${esc(b.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <span class="grow">
        <strong class="mono">${esc(b.tagNumber)}</strong>
        <span class="fs-sm muted"> · ${fmtWeight(b.weightKg)}</span>
        ${disabled ? '<br><span class="fs-xs muted">Already reported — being handled</span>' : ''}
      </span>
    </label>`;
}

function wireBody() {
  appEl.querySelector('[data-action="go-arrival"]')?.addEventListener('click', () => navigate('#/arrival'));
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  const form = appEl.querySelector('#report-form');
  if (!form) return;
  form.querySelectorAll('[data-bag-id]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.bagId);
      else selected.delete(cb.dataset.bagId);
      validateBags();
    });
  });
  const countEl = form.querySelector('#desc-count');
  form.description.addEventListener('input', () => {
    countEl.textContent = String(form.description.value.length);
    validateDescription();
  });
  form.description.addEventListener('blur', validateDescription);
  form.phone.addEventListener('blur', validatePhone);
  form.addEventListener('submit', onSubmit);
}

function validateBags() {
  const err = appEl.querySelector('#err-bags');
  if (!err) return true;
  if (!selected.size) { err.textContent = 'Select at least one bag.'; err.hidden = false; return false; }
  err.hidden = true;
  return true;
}

function validateDescription() {
  const form = appEl.querySelector('#report-form');
  const err = appEl.querySelector('#err-description');
  const val = form.description.value.trim();
  if (val.length < 10 || val.length > 500) {
    err.textContent = 'Description must be 10–500 characters.'; err.hidden = false;
    form.description.setAttribute('aria-invalid', 'true');
    return false;
  }
  err.hidden = true;
  form.description.removeAttribute('aria-invalid');
  return true;
}

function validatePhone() {
  const form = appEl.querySelector('#report-form');
  const err = appEl.querySelector('#err-phone');
  const val = form.phone.value.trim();
  if (!/^\+\d{8,15}$/.test(val)) {
    err.textContent = 'Enter a valid phone number, e.g. +966501234567.'; err.hidden = false;
    form.phone.setAttribute('aria-invalid', 'true');
    return false;
  }
  err.hidden = true;
  form.phone.removeAttribute('aria-invalid');
  return true;
}

function validateAll() {
  const bagsOk = validateBags();
  const descOk = validateDescription();
  const phoneOk = validatePhone();
  return bagsOk && descOk && phoneOk;
}

async function onSubmit(e) {
  e.preventDefault();
  if (!validateAll()) { announce('Please fix the errors in the form.'); return; }
  if (submitting) return;
  submitting = true;
  const form = appEl.querySelector('#report-form');
  const btn = appEl.querySelector('#submit-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.querySelector('.label').textContent = 'Submitting…';
  try {
    const res = await api.reportMissing({
      bagIds: [...selected],
      description: form.description.value.trim(),
      phone: form.phone.value.trim(),
    });
    if (!mounted) return;
    toast(`Reported ${res.created} bag${res.created === 1 ? '' : 's'} missing.`, 'success');
    navigate('#/arrival/resolution');
  } catch (err) {
    if (!mounted) return;
    submitting = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.querySelector('.label').textContent = 'Submit report';
    toast(err.message, 'error');
    announce(err.message);
  }
}
