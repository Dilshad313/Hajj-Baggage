import { icon } from '../ui.js';

/**
 * Mounts a canvas signature pad with pointer-event drawing and a Clear button.
 * @param {HTMLElement} container
 * @param {{onChange?:(isEmpty:boolean)=>void}} [opts]
 * @returns {{ isEmpty:()=>boolean, toDataUrl:()=>string|null, clear:()=>void, destroy:()=>void }}
 */
export function createSignaturePad(container, opts = {}) {
  let isEmpty = true;
  let drawing = false;
  let last = null;

  container.innerHTML = `
    <div class="signature-pad-wrap" id="sig-wrap">
      <canvas class="signature-pad-canvas" id="sig-canvas" aria-label="Signature pad — draw your signature"></canvas>
    </div>
    <button type="button" class="btn btn-ghost" style="margin-block-start:var(--s2)" id="sig-clear">${icon('eraser', 16)} Clear</button>`;

  const wrap = container.querySelector('#sig-wrap');
  const canvas = container.querySelector('#sig-canvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const prev = isEmpty ? null : canvas.toDataURL();
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    drawing = true;
    last = pointFromEvent(e);
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drawing) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    if (isEmpty) {
      isEmpty = false;
      wrap.classList.add('signed');
      opts.onChange?.(false);
    }
  }

  function onPointerUp(e) {
    drawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    isEmpty = true;
    wrap.classList.remove('signed');
    opts.onChange?.(true);
  }
  container.querySelector('#sig-clear').addEventListener('click', clear);

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    isEmpty: () => isEmpty,
    toDataUrl: () => (isEmpty ? null : canvas.toDataURL('image/png')),
    clear,
    destroy: () => { ro.disconnect(); container.innerHTML = ''; },
  };
}
