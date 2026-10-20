import { esc, icon, announce, playBeep, vibrate, openModal } from '../ui.js';
import { isDemoMode } from '../store.js';

/**
 * Mounts a reusable scan field: big auto-focused text input (Enter submits —
 * a USB/Bluetooth scanner just types + Enter), a camera-scan option, a
 * success/failure result banner with Retry/Manual entry, and (in demo mode)
 * a "simulate scan failure" toggle.
 * @param {HTMLElement} container
 * @param {{
 *   label?: string,
 *   placeholder?: string,
 *   autofocus?: boolean,
 *   onSubmit: (code:string, opts:{manual:boolean}) => Promise<{message?:string}|void>,
 * }} opts
 * @returns {{ reset:()=>void, focus:()=>void, destroy:()=>void }}
 */
export function createScanInput(container, opts) {
  let simulateFail = false;
  let manualMode = false;
  let submitting = false;
  let destroyed = false;

  function render() {
    container.innerHTML = `
      <div class="scan-input-wrap">
        <div class="field" style="margin-block-end:var(--s3)">
          <label for="scan-field-input">${manualMode ? 'Enter code manually' : esc(opts.label || 'Scan or type code')}</label>
          <input id="scan-field-input" class="scan-field" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="${manualMode ? 'Type the exact code' : esc(opts.placeholder || 'Scan or type code')}" ${submitting ? 'disabled' : ''} />
          ${manualMode ? `<div class="hint">Must exactly match the expected code.</div>` : ''}
        </div>
        ${!manualMode ? `
          <div class="row gap-2 wrap">
            <button type="button" class="btn btn-secondary btn-block" data-act="camera" ${submitting ? 'disabled' : ''}>${icon('camera', 18)} Use camera</button>
          </div>
          <button type="button" class="btn btn-ghost" style="margin-block-start:var(--s2)" data-act="manual-toggle">${icon('keyboard', 16)} Manual entry</button>
        ` : `
          <button type="button" class="btn btn-ghost" data-act="manual-cancel">${icon('arrow-left', 16)} Back to scanning</button>
        `}
        ${isDemoMode() ? `
          <label class="checkbox-row" style="margin-block-start:var(--s3)">
            <input type="checkbox" id="scan-sim-fail" ${simulateFail ? 'checked' : ''} />
            Simulate scan failure (next scan)
          </label>` : ''}
        <div id="scan-result-root"></div>
      </div>`;
    const field = container.querySelector('#scan-field-input');
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(field.value, manualMode); } });
    container.querySelector('[data-act="camera"]')?.addEventListener('click', openCamera);
    container.querySelector('[data-act="manual-toggle"]')?.addEventListener('click', () => { manualMode = true; render(); });
    container.querySelector('[data-act="manual-cancel"]')?.addEventListener('click', () => { manualMode = false; render(); });
    container.querySelector('#scan-sim-fail')?.addEventListener('change', (e) => { simulateFail = e.target.checked; });
    if (!submitting && opts.autofocus !== false) field.focus();
  }

  async function submit(rawValue, manual) {
    const code = String(rawValue || '').trim();
    if (!code) return;
    const resultRoot = container.querySelector('#scan-result-root');
    if (simulateFail) {
      simulateFail = false;
      showResult(resultRoot, false, 'Simulated scan failure.', manual);
      return;
    }
    submitting = true;
    render();
    const resultRoot2 = container.querySelector('#scan-result-root');
    try {
      const result = await opts.onSubmit(code, { manual });
      if (destroyed) return;
      playBeep();
      vibrate(30);
      showResult(resultRoot2, true, result?.message || 'Scan accepted.', manual);
    } catch (err) {
      if (destroyed) return;
      playBeep(true);
      showResult(resultRoot2, false, err.message, manual);
    } finally {
      submitting = false;
    }
  }

  function showResult(root, success, message, manual) {
    announce(message);
    root.innerHTML = `
      <div class="scan-result-banner ${success ? 'ok' : 'fail'}" role="status">
        <span class="icon">${icon(success ? 'check-circle' : 'x-circle', 22)}</span>
        <span class="fs-sm">${esc(message)}${manual && success ? ' <strong>(Manual entry)</strong>' : ''}</span>
      </div>
      ${!success ? `
        <div class="row gap-2 wrap" style="margin-block-start:var(--s3)">
          <button type="button" class="btn btn-secondary" data-act="retry">${icon('rotate-ccw', 16)} Retry</button>
          ${!manualMode ? `<button type="button" class="btn btn-secondary" data-act="manual-after-fail">${icon('keyboard', 16)} Manual entry</button>` : ''}
        </div>` : ''}`;
    if (!success) {
      root.querySelector('[data-act="retry"]').addEventListener('click', () => { root.innerHTML = ''; reset(); });
      root.querySelector('[data-act="manual-after-fail"]')?.addEventListener('click', () => { manualMode = true; render(); });
    } else {
      setTimeout(() => { if (!destroyed) reset(); }, 900);
    }
  }

  function openCamera() {
    let scanner = null;
    const close = openModal({
      title: 'Scan with camera',
      bodyHtml: `<div id="qr-camera-region" class="scan-camera-video"></div><p class="fs-sm muted" id="qr-camera-status" style="margin-block-start:var(--s2)">Starting camera…</p>`,
      onDismiss: () => stopScanner(),
    });
    function stopScanner() {
      if (scanner) { scanner.stop().catch(() => {}).finally(() => scanner.clear?.()); scanner = null; }
    }
    if (!window.Html5Qrcode) {
      const status = document.querySelector('#qr-camera-status');
      if (status) status.textContent = 'Camera scanning is unavailable in this browser.';
      return;
    }
    scanner = new window.Html5Qrcode('qr-camera-region');
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      (decodedText) => { stopScanner(); close(); submit(decodedText, false); },
      () => { /* per-frame scan miss — ignore */ },
    ).catch(() => {
      const status = document.querySelector('#qr-camera-status');
      if (status) status.textContent = 'Could not access the camera — check permissions, or use the text field instead.';
    });
  }

  function reset() {
    manualMode = false;
    submitting = false;
    render();
  }

  render();

  return {
    reset,
    focus: () => container.querySelector('#scan-field-input')?.focus(),
    destroy: () => { destroyed = true; container.innerHTML = ''; },
  };
}
