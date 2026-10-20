import * as api from '../api.js';
import { toast, announce } from '../ui.js';
import { navigate } from '../router.js';

const DEMO_ACCOUNTS = [
  { label: 'Dewi — Garuda (GA)', employeeId: 'AL-GA-01', pin: '1234', hint: 'GA flights only' },
  { label: 'Usman — PIA (PK)', employeeId: 'AL-PK-01', pin: '1234', hint: 'PK flights only' },
  { label: 'Fahad — Ground Handler', employeeId: 'GH-001', pin: '1234', hint: 'All airlines' },
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
        <h1 class="fs-lg">Airline / Ground Handler sign in</h1>
        <p class="muted fs-sm" style="margin-block-end:var(--s5)">Sign in to accept handovers and load baggage for your flights.</p>
        <div id="login-alert" role="alert"></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="employeeId">Employee ID <span class="req">*</span></label>
            <input id="employeeId" name="employeeId" type="text" autocomplete="username" placeholder="AL-GA-01" required />
            <div class="error" id="err-employeeId" hidden></div>
          </div>
          <div class="field">
            <label for="pin">PIN <span class="req">*</span></label>
            <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
            <div class="error" id="err-pin" hidden></div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-submit">
            <span class="label">Sign in</span>
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
    btn.querySelector('.label').textContent = 'Signing in…';
    const alertBox = app.querySelector('#login-alert');
    alertBox.innerHTML = '';
    try {
      await api.login(form.employeeId.value.trim(), form.pin.value.trim());
      toast('Welcome back.', 'success');
      navigate('#/');
    } catch (err) {
      alertBox.innerHTML = `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">${err.message}</div>`;
      announce(err.message);
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Sign in';
    }
  });

  return { destroy };
}

/** No timers to clean up. */
export function destroy() { /* no-op */ }
