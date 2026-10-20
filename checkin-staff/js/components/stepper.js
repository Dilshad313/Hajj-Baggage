import { esc } from '../ui.js';

/**
 * Renders a numbered step header: completed steps get a check, the current
 * step is highlighted with `aria-current="step"`. The stepper never lets the
 * user skip ahead, so steps are always view-only (not links).
 * @param {string[]} labels
 * @param {number} currentIndex 1-based index of the current step
 * @returns {string}
 */
export function stepperHtml(labels, currentIndex) {
  return `<div class="sr-stepper" role="list" aria-label="Check-in progress">${labels.map((label, i) => {
    const n = i + 1;
    const done = n < currentIndex;
    return `<div class="sr-step ${done ? 'done' : ''}" role="listitem" ${n === currentIndex ? 'aria-current="step"' : ''}>
      <span class="num">${done ? '✓' : n}</span>${esc(label)}
    </div>`;
  }).join('')}</div>`;
}
