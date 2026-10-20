import * as api from '../api.js';
import { toast, announce } from '../ui.js';
import { navigate } from '../router.js';

const DEMO = { employeeId: 'ADM-001', pin: '1234' };

let pendingAdminId = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  pendingAdminId = null;
  renderStep1(app);
  return { destroy };
}

export function destroy() { /* no timers to clean up */ }

function renderStep1(app) {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="brand" style="margin-block-end:var(--s6)">
          <span class="brand-name fs-xl">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <h1 class="fs-lg">System Admin sign in</h1>
        <p class="muted fs-sm" style="margin-block-end:var(--s5)">Platform administration console.</p>
        <div id="login-alert" role="alert"></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="employeeId">Employee ID <span class="req">*</span></label>
            <input id="employeeId" name="employeeId" type="text" autocomplete="username" placeholder="ADM-001" required />
            <div class="error" id="err-employeeId" hidden></div>
          </div>
          <div class="field">
            <label for="pin">PIN <span class="req">*</span></label>
            <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
            <div class="error" id="err-pin" hidden></div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%" id="login-submit">
            <span class="label">Continue</span>
          </button>
        </form>
        <p class="fs-sm muted" style="margin-block-start:var(--s5)">Demo admin</p>
        <div class="demo-chip-list">
          <button type="button" class="demo-chip" data-demo="1">Admin — Zaid</button>
        </div>
      </div>
    </div>`;

  const form = app.querySelector('#login-form');
  app.querySelector('[data-demo="1"]').addEventListener('click', () => {
    form.employeeId.value = DEMO.employeeId;
    form.pin.value = DEMO.pin;
    form.employeeId.focus();
  });

  function validate() {
    let valid = true;
    const idErr = app.querySelector('#err-employeeId');
    const pinErr = app.querySelector('#err-pin');
    if (!form.employeeId.value.trim()) {
      idErr.textContent = 'Employee ID is required.'; idErr.hidden = false;
      form.employeeId.setAttribute('aria-invalid', 'true'); valid = false;
    } else { idErr.hidden = true; form.employeeId.removeAttribute('aria-invalid'); }
    if (!form.pin.value.trim()) {
      pinErr.textContent = 'PIN is required.'; pinErr.hidden = false;
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
    btn.querySelector('.label').textContent = 'Verifying…';
    const alertBox = app.querySelector('#login-alert');
    alertBox.innerHTML = '';
    try {
      const result = await api.adminLogin(form.employeeId.value.trim(), form.pin.value.trim());
      pendingAdminId = result.pendingAdminId;
      renderStep2(app);
    } catch (err) {
      alertBox.innerHTML = `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">${err.message}</div>`;
      announce(err.message);
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Continue';
    }
  });
}

function renderStep2(app) {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="brand" style="margin-block-end:var(--s6)">
          <span class="brand-name fs-xl">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <h1 class="fs-lg">Two-factor verification</h1>
        <p class="muted fs-sm" style="margin-block-end:var(--s5)">Enter the 6-digit code sent to your device. (Demo code: <strong class="mono">123456</strong>)</p>
        <div id="twofa-alert" role="alert"></div>
        <form id="twofa-form" novalidate>
          <div class="field">
            <label for="code">Verification code <span class="req">*</span></label>
            <input id="code" name="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
            <div class="error" id="err-code" hidden></div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%" id="twofa-submit">
            <span class="label">Verify &amp; sign in</span>
          </button>
          <button type="button" class="btn btn-ghost" style="width:100%;margin-block-start:var(--s2)" id="twofa-back">Back</button>
        </form>
      </div>
    </div>`;

  const form = app.querySelector('#twofa-form');
  app.querySelector('#twofa-back').addEventListener('click', () => renderStep1(app));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeErr = app.querySelector('#err-code');
    if (!/^\d{6}$/.test(form.code.value.trim())) {
      codeErr.textContent = 'Enter the 6-digit code.'; codeErr.hidden = false;
      form.code.setAttribute('aria-invalid', 'true');
      return;
    }
    codeErr.hidden = true; form.code.removeAttribute('aria-invalid');
    const btn = app.querySelector('#twofa-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    btn.querySelector('.label').textContent = 'Verifying…';
    const alertBox = app.querySelector('#twofa-alert');
    alertBox.innerHTML = '';
    try {
      await api.verify2fa(pendingAdminId, form.code.value.trim());
      toast('Welcome back.', 'success');
      navigate('#/');
    } catch (err) {
      alertBox.innerHTML = `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">${err.message}</div>`;
      announce(err.message);
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Verify & sign in';
    }
  });
}
