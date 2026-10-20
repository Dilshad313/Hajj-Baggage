import * as api from '../api.js';
import { toast, announce, esc } from '../ui.js';
import { navigate } from '../router.js';

const CENTRES = [{ id: 'AZIZIYAH', name: 'Aziziyah' }, { id: 'AL-AWALI', name: 'Al-Awali' }, { id: 'MADINAH', name: 'Madinah' }];
const DEMO_ACCOUNTS = [
  { label: 'Omar', employeeId: 'CHK-001', pin: '1234', centreId: 'AZIZIYAH', hint: 'Aziziyah' },
  { label: 'Yusuf', employeeId: 'CHK-002', pin: '1234', centreId: 'AL-AWALI', hint: 'Al-Awali' },
  { label: 'Bilal', employeeId: 'CHK-003', pin: '1234', centreId: 'MADINAH', hint: 'Madinah' },
  { label: 'Khalid', employeeId: 'SUP-001', pin: '1234', centreId: 'AZIZIYAH', hint: 'Supervisor' },
];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="brand" style="margin-block-end:var(--s6)">
          <span class="brand-name fs-xl">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <h1 class="fs-lg">Check-in terminal sign in</h1>
        <p class="muted fs-sm" style="margin-block-end:var(--s5)">Sign in to start your shift at the counter.</p>
        <div id="login-alert" role="alert"></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="employeeId">Employee ID <span class="req">*</span></label>
            <input id="employeeId" name="employeeId" type="text" autocomplete="username" placeholder="CHK-001" required />
            <div class="error" id="err-employeeId" hidden></div>
          </div>
          <div class="field">
            <label for="pin">PIN <span class="req">*</span></label>
            <input id="pin" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" required />
            <div class="error" id="err-pin" hidden></div>
          </div>
          <div class="grid grid-cols-2">
            <div class="field">
              <label for="centreId">Check-in centre <span class="req">*</span></label>
              <select id="centreId" name="centreId" required>${CENTRES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="counterNo">Counter no. <span class="req">*</span></label>
              <select id="counterNo" name="counterNo" required>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
            </div>
          </div>
          <label class="checkbox-row" style="margin-block-end:var(--s4)">
            <input type="checkbox" id="covering" />
            I am covering another centre today
          </label>
          <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-submit">
            <span class="label">Start shift</span>
          </button>
        </form>
        <p class="fs-sm muted" style="margin-block-start:var(--s5)">Demo accounts</p>
        <div class="demo-chip-list">
          ${DEMO_ACCOUNTS.map((d, i) => `<button type="button" class="demo-chip" data-demo="${i}">${d.label} <span class="muted">· ${d.hint}</span></button>`).join('')}
        </div>
      </div>
    </div>`;

  const form = app.querySelector('#login-form');
  app.querySelectorAll('[data-demo]').forEach((btn) => btn.addEventListener('click', () => {
    const d = DEMO_ACCOUNTS[Number(btn.dataset.demo)];
    form.employeeId.value = d.employeeId;
    form.pin.value = d.pin;
    form.centreId.value = d.centreId;
    form.employeeId.focus();
  }));

  function validate() {
    let valid = true;
    const idErr = app.querySelector('#err-employeeId');
    const pinErr = app.querySelector('#err-pin');
    if (!form.employeeId.value.trim()) {
      idErr.textContent = 'Employee ID is required.'; idErr.hidden = false;
      form.employeeId.setAttribute('aria-invalid', 'true'); valid = false;
    } else { idErr.hidden = true; form.employeeId.removeAttribute('aria-invalid'); }
    if (!/^\d{4}$/.test(form.pin.value.trim())) {
      pinErr.textContent = 'PIN must be exactly 4 digits.'; pinErr.hidden = false;
      form.pin.setAttribute('aria-invalid', 'true'); valid = false;
    } else { pinErr.hidden = true; form.pin.removeAttribute('aria-invalid'); }
    return valid;
  }
  form.employeeId.addEventListener('blur', validate);
  form.pin.addEventListener('blur', validate);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const btn = app.querySelector('#login-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    btn.querySelector('.label').textContent = 'Starting shift…';
    const alertBox = app.querySelector('#login-alert');
    alertBox.innerHTML = '';
    try {
      await api.staffLogin(form.employeeId.value.trim(), form.pin.value.trim(), form.centreId.value, Number(form.counterNo.value), form.covering.checked);
      toast('Shift started.', 'success');
      navigate('#/');
    } catch (err) {
      const amber = /assigned to|in use by/i.test(err.message);
      alertBox.innerHTML = `<div class="field error" style="background:${amber ? 'var(--warning-soft)' : 'var(--danger-soft)'};color:${amber ? '#7C4A03' : 'inherit'};padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">${esc(err.message)}</div>`;
      announce(err.message);
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Start shift';
    }
  });

  return { destroy };
}

/** No timers to clean up. */
export function destroy() { /* no-op */ }
