import { esc } from '../ui.js';

/**
 * Renders a numbered step header: completed steps get a check, the current
 * step is highlighted with `aria-current="step"`. Completed steps are
 * view-only (not links) — tapping them does nothing.
 * @param {string[]} labels
 * @param {number} currentIndex 1-based index of the current step
 * @returns {string}
 */
export function stepperHtml(labels, currentIndex) {
  return `<div class="sr-stepper" role="list" aria-label="Trip progress">${labels.map((label, i) => {
    const n = i + 1;
    const done = n < currentIndex;
    return `<div class="sr-step ${done ? 'done' : ''}" role="listitem" ${n === currentIndex ? 'aria-current="step"' : ''}>
      <span class="num">${done ? '✓' : n}</span>${esc(label)}
    </div>`;
  }).join('')}</div>`;
}
