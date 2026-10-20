import { icon } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  app.innerHTML = `
    <div class="state-block" style="padding-block:var(--s12)">
      <div style="color:var(--success)">${icon('check-circle', 64)}</div>
      <h1 class="fs-xl fw-semibold" style="color:var(--text)">You're all set</h1>
      <p class="muted">Thank you for using Rabel. Your baggage journey is complete.</p>
      <button type="button" class="btn btn-primary btn-lg" data-action="home" style="margin-block-start:var(--s4)">Back to home</button>
    </div>`;
  app.querySelector('[data-action="home"]').addEventListener('click', () => navigate('#/'));
  return { destroy };
}

/** No timers to clean up. */
export function destroy() {
  appEl = null;
}
