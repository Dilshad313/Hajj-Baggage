/**
 * Mounts a canvas signature pad into `container`.
 * @param {HTMLElement} container
 * @returns {{ isEmpty:()=>boolean, getDataUrl:()=>string|null, clear:()=>void, destroy:()=>void }}
 */
export function createSignaturePad(container) {
  container.innerHTML = `
    <div class="sig-pad-wrap"><canvas class="sig-canvas" aria-label="Signature pad — draw the receiver's signature"></canvas></div>
    <button type="button" class="btn btn-secondary" data-act="clear-sig" style="margin-block-start:var(--s2)">Clear</button>`;

  const canvas = container.querySelector('.sig-canvas');
  const ctx = canvas.getContext('2d');
  let hasDrawn = false;
  let drawing = false;
  let last = null;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0F172A';

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e) {
    drawing = true;
    hasDrawn = true;
    last = pos(e);
    canvas.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function end() { drawing = false; }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  }
  container.querySelector('[data-act="clear-sig"]').addEventListener('click', clear);

  return {
    isEmpty: () => !hasDrawn,
    getDataUrl: () => (hasDrawn ? canvas.toDataURL('image/png') : null),
    clear,
    destroy: () => { container.innerHTML = ''; },
  };
}
