import * as api from '../api.js';
import { toast, announce } from '../ui.js';
import { navigate } from '../router.js';

const DEMO_PILGRIMS = [
  { label: 'Siti — new booking', nusukId: '1000000001', passport: 'C1234567' },
  { label: 'Asif — bags in transit', nusukId: '1000000002', passport: 'AB7654321' },
  { label: 'Karim — bag issue', nusukId: '1000000003', passport: 'BX0987654' },
  { label: 'Fatima — on board', nusukId: '1000000004', passport: 'A09876543' },
  { label: 'Aisyah — delivery today', nusukId: '1000000005', passport: 'C7654321' },
  { label: 'Ahmed — arriving', nusukId: '1000000006', passport: 'AB1234567' },
  { label: 'Hassan — missing bag', nusukId: '1000000007', passport: 'A01234567' },
];

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="brand" style="margin-block-end:var(--s6);align-items:center;text-align:center">
          <span class="brand-name fs-xl">Rabel</span>
          <span class="brand-ar">رابل — خدمة أمتعة الحجاج</span>
        </div>
        <h1 class="fs-lg" style="text-align:center">Login with Nusuk</h1>
        <p class="muted fs-sm" style="margin-block-end:var(--s5);text-align:center">Track and manage your Hajj baggage.</p>
        <div id="login-alert" role="alert"></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="nusukId">Nusuk ID <span class="req">*</span></label>
            <input id="nusukId" name="nusukId" type="text" inputmode="numeric" autocomplete="username" placeholder="1000000001" maxlength="10" required />
            <div class="error" id="err-nusukId" hidden></div>
          </div>
          <div class="field">
            <label for="passport">Passport number <span class="req">*</span></label>
            <input id="passport" name="passport" type="text" autocomplete="off" placeholder="C1234567" required style="text-transform:uppercase" />
            <div class="error" id="err-passport" hidden></div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-submit">
            <span class="label">Login with Nusuk</span>
          </button>
        </form>
        <p class="fs-sm muted" style="margin-block-start:var(--s5);text-align:center">Demo pilgrims</p>
        <div class="demo-chip-list" style="justify-content:center">
          ${DEMO_PILGRIMS.map((d, i) => `<button type="button" class="demo-chip" data-demo="${i}">${d.label}</button>`).join('')}
        </div>
      </div>
    </div>`;

  const form = app.querySelector('#login-form');
  app.querySelectorAll('[data-demo]').forEach((btn) => btn.addEventListener('click', () => {
    const d = DEMO_PILGRIMS[Number(btn.dataset.demo)];
    form.nusukId.value = d.nusukId;
    form.passport.value = d.passport;
    form.nusukId.focus();
  }));

  function validate() {
    let valid = true;
    const idErr = app.querySelector('#err-nusukId');
    const passErr = app.querySelector('#err-passport');
    const nusukId = form.nusukId.value.trim();
    const passport = form.passport.value.trim();
    if (!/^\d{10}$/.test(nusukId)) {
      idErr.textContent = 'Nusuk ID must be 10 digits.'; idErr.hidden = false;
      form.nusukId.setAttribute('aria-invalid', 'true'); valid = false;
    } else { idErr.hidden = true; form.nusukId.removeAttribute('aria-invalid'); }
    if (!/^[A-Za-z0-9]{6,12}$/.test(passport)) {
      passErr.textContent = 'Enter a valid passport number.'; passErr.hidden = false;
      form.passport.setAttribute('aria-invalid', 'true'); valid = false;
    } else { passErr.hidden = true; form.passport.removeAttribute('aria-invalid'); }
    return valid;
  }
  form.nusukId.addEventListener('blur', validate);
  form.passport.addEventListener('blur', validate);
  form.passport.addEventListener('input', () => { form.passport.value = form.passport.value.toUpperCase(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const btn = app.querySelector('#login-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    btn.querySelector('.label').textContent = 'Verifying with Nusuk…';
    const alertBox = app.querySelector('#login-alert');
    alertBox.innerHTML = '';
    await delay(1000);
    try {
      await api.login(form.nusukId.value.trim(), form.passport.value.trim());
      toast('Welcome back.', 'success');
      navigate('#/');
    } catch (err) {
      alertBox.innerHTML = `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">${err.message}</div>`;
      announce(err.message);
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Login with Nusuk';
    }
  });

  return { destroy };
}

/** No timers to clean up. */
export function destroy() { /* no-op */ }
