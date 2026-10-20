/**
 * UI helpers shared by all views: toasts, modal/confirm, drawer, skeletons,
 * empty/error state blocks, formatters, and feedback (beep/vibrate).
 */

const RIYADH_TZ = 'Asia/Riyadh';

/** @param {string|Date} value @returns {string} */
export function fmtDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: RIYADH_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** @param {string|Date} value @returns {string} */
export function fmtDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: RIYADH_TZ, dateStyle: 'medium' }).format(new Date(value));
}

/** @param {string|Date} value @returns {string} */
export function fmtTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: RIYADH_TZ, timeStyle: 'short' }).format(new Date(value));
}

/** @param {number} value @returns {string} */
export function fmtNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

/** @param {number} kg @returns {string} */
export function fmtWeight(kg) {
  if (kg == null) return '—';
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kg)} kg`;
}

/** @param {string|Date} value @returns {string} "5 min ago" with exact time available via title */
export function fmtRelative(value) {
  if (!value) return '—';
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/**
 * Formats a future (or past) duration as e.g. "1 h 20 min" / "-15 min" for overdue.
 * @param {string|Date} value @returns {string}
 */
export function fmtCountdown(value) {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const overdue = diffMs < 0;
  const totalMin = Math.round(Math.abs(diffMs) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const str = h > 0 ? `${h} h ${m} min` : `${m} min`;
  return overdue ? `-${str}` : str;
}

/** @param {string} name lucide icon name @param {number} [size] @returns {string} */
export function icon(name, size = 20) {
  return `<i data-lucide="${esc(name)}" style="width:${size}px;height:${size}px;display:inline-block" aria-hidden="true"></i>`;
}

/** @param {string} s @returns {string} escaped for innerHTML text nodes */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===================== Feedback: beep + haptic ===================== */

let beepMuted = false;
let audioCtx = null;

/** Mutes/unmutes the scan-success beep. @param {boolean} muted */
export function setBeepMuted(muted) { beepMuted = muted; }
/** @returns {boolean} */
export function isBeepMuted() { return beepMuted; }

/** Plays a short confirmation beep via WebAudio (no-op if muted or unavailable). @param {boolean} [low] a lower, "failure" tone */
export function playBeep(low) {
  if (beepMuted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = low ? 220 : 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.16);
  } catch (e) { /* audio unavailable — ignore */ }
}

/** Triggers a short haptic pulse where supported. @param {number} [ms] */
export function vibrate(ms = 30) {
  try { navigator.vibrate?.(ms); } catch (e) { /* unsupported — ignore */ }
}

/* ===================== Toast ===================== */

let toastRoot = null;

function ensureToastRoot() {
  if (!toastRoot) toastRoot = document.getElementById('toast-root');
  return toastRoot;
}

/** @param {string} message @param {'success'|'error'|'info'} [type] */
export function toast(message, type = 'info') {
  const root = ensureToastRoot();
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ===================== Modal / Confirm ===================== */

let lastFocused = null;

/** Traps Tab navigation within container. Escape is handled by each caller so nested dialogs (e.g. a confirm over a drawer) don't close the wrong layer. */
function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const focusables = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

let activeOverlay = null;
let activeKeyHandler = null;

function closeOverlay() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
  }
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  lastFocused = null;
}

/**
 * Opens a confirm dialog.
 * @param {{title:string, body:string, confirmLabel?:string, danger?:boolean, requireText?:string}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    lastFocused = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">${esc(opts.title)}</h2>
        <p class="text-2" style="margin-block-start:var(--s3)">${esc(opts.body)}</p>
        ${opts.requireText ? `
          <div class="field" style="margin-block-start:var(--s4)">
            <label for="confirm-input">Type <strong class="mono">${esc(opts.requireText)}</strong> to confirm</label>
            <input id="confirm-input" type="text" autocomplete="off" />
          </div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm" ${opts.requireText ? 'disabled' : ''}>${esc(opts.confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    const confirmBtn = overlay.querySelector('[data-act="confirm"]');
    const input = overlay.querySelector('#confirm-input');
    if (input) {
      input.addEventListener('input', () => {
        confirmBtn.disabled = input.value.trim() !== opts.requireText;
      });
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { closeOverlay(); resolve(false); }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') { closeOverlay(); resolve(false); }
      if (act === 'confirm' && !confirmBtn.disabled) { closeOverlay(); resolve(true); }
    });
    activeKeyHandler = (e) => {
      trapFocus(overlay, e);
      if (e.key === 'Escape') { closeOverlay(); resolve(false); }
    };
    document.addEventListener('keydown', activeKeyHandler);
    (input || confirmBtn).focus();
  });
}

/**
 * Opens an arbitrary modal with custom content.
 * @param {{title:string, bodyHtml:string, large?:boolean, onMount?:(el:HTMLElement)=>void, onDismiss?:()=>void}} opts
 * @returns {() => void} close function
 */
export function openModal(opts) {
  lastFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal ${opts.large ? 'modal-lg' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="row" style="justify-content:space-between">
        <h2 id="modal-title">${esc(opts.title)}</h2>
        <button type="button" class="btn btn-ghost btn-icon" data-act="close" aria-label="Close dialog">✕</button>
      </div>
      <div class="modal-body" style="margin-block-start:var(--s4)">${opts.bodyHtml}</div>
    </div>`;
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  const dismiss = () => { closeOverlay(); opts.onDismiss?.(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) dismiss();
  });
  activeKeyHandler = (e) => { trapFocus(overlay, e); if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', activeKeyHandler);
  overlay.querySelector('.modal').focus?.();
  if (opts.onMount) opts.onMount(overlay);
  return closeOverlay;
}

/* ===================== Drawer ===================== */

let activeDrawer = null;
let drawerKeyHandler = null;
let drawerLastFocused = null;

/** @returns {void} */
export function closeDrawer() {
  if (activeDrawer) {
    activeDrawer.overlay.remove();
    activeDrawer.el.remove();
    activeDrawer = null;
  }
  if (drawerKeyHandler) {
    document.removeEventListener('keydown', drawerKeyHandler);
    drawerKeyHandler = null;
  }
  if (drawerLastFocused && drawerLastFocused.focus) drawerLastFocused.focus();
  drawerLastFocused = null;
}

/**
 * Opens a right-side drawer.
 * @param {{title:string, bodyHtml:string, footerHtml?:string, large?:boolean, onClose?:() => (boolean|void|Promise<boolean>)}} opts
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openDrawer(opts) {
  drawerLastFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = `drawer ${opts.large ? 'drawer-lg' : ''}`;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-labelledby', 'drawer-title');
  drawer.innerHTML = `
    <div class="drawer-header">
      <h2 id="drawer-title" class="fs-lg">${esc(opts.title)}</h2>
      <button type="button" class="btn btn-ghost btn-icon" data-act="close-drawer" aria-label="Close panel">✕</button>
    </div>
    <div class="drawer-body">${opts.bodyHtml}</div>
    ${opts.footerHtml ? `<div class="drawer-footer">${opts.footerHtml}</div>` : ''}
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  activeDrawer = { overlay, el: drawer };

  let closeGuardPending = false;
  const attemptClose = () => {
    if (closeGuardPending) return;
    if (!opts.onClose) { closeDrawer(); return; }
    const result = opts.onClose();
    if (result && typeof result.then === 'function') {
      closeGuardPending = true;
      result.then((allow) => {
        closeGuardPending = false;
        if (allow !== false) closeDrawer();
      });
      return;
    }
    if (result === false) return;
    closeDrawer();
  };
  overlay.addEventListener('click', attemptClose);
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close-drawer"]')) attemptClose();
  });
  drawerKeyHandler = (e) => {
    trapFocus(drawer, e);
    if (e.key === 'Escape') attemptClose();
  };
  document.addEventListener('keydown', drawerKeyHandler);
  drawer.querySelector('input,select,textarea,button')?.focus();
  return { el: drawer, close: attemptClose };
}

/* ===================== State blocks ===================== */

/** @param {number} [rows] @returns {string} */
export function skeletonBlock(rows = 4) {
  return `<div class="stack gap-2">${Array.from({ length: rows }).map(() => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
}

/** @param {{icon?:string, message:string, actionLabel?:string, actionAttr?:string}} opts @returns {string} */
export function emptyState(opts) {
  return `
    <div class="state-block empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
      <p>${esc(opts.message)}</p>
      ${opts.actionLabel ? `<button type="button" class="btn btn-primary" ${opts.actionAttr || ''}>${esc(opts.actionLabel)}</button>` : ''}
    </div>`;
}

/** @param {{message:string, retryAttr?:string}} opts @returns {string} */
export function errorState(opts) {
  return `
    <div class="state-block error-state" role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <p>${esc(opts.message)}</p>
      <button type="button" class="btn btn-secondary" ${opts.retryAttr || 'data-action="retry"'}>Retry</button>
    </div>`;
}

/** Announce a message to assistive tech via a live region. @param {string} message */
export function announce(message) {
  let region = document.getElementById('live-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'live-region';
    region.className = 'visually-hidden';
    region.setAttribute('aria-live', 'assertive');
    document.body.appendChild(region);
  }
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

/** Download a Blob as a file. @param {string} filename @param {string} content @param {string} [mime] */
export function downloadBlob(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @param {object[]} rows @param {string[]} columns @returns {string} CSV text */
export function toCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((c) => {
    const v = row[c] ?? '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(','));
  return [header, ...lines].join('\n');
}
