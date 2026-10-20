import * as api from '../api.js';
import { toast, icon, esc, announce, skeletonBlock, errorState } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;
let mounted = false;
let stars = 0;
let comment = '';
let existing = false;
let loading = true;
let loadError = '';
let submitting = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  stars = 0;
  comment = '';
  existing = false;
  loading = true;
  loadError = '';
  submitting = false;
  renderShell();
  load();
  return { destroy };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true;
  loadError = '';
  renderShell();
  try {
    const rating = await api.getRating();
    if (!mounted) return;
    if (rating) {
      stars = rating.stars;
      comment = rating.comment;
      existing = true;
    }
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Rate your experience</h1>
      <p class="page-subtitle">Let us know how we did with your baggage.</p>
    </div>
    <div id="rate-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(4);
  if (loadError) return errorState({ message: loadError });
  return formHtml();
}

function formHtml() {
  return `
    <form id="rate-form" novalidate>
      <div class="field" style="align-items:center">
        <label style="text-align:center">How would you rate your baggage experience?</label>
        <div class="star-rating" role="radiogroup" aria-label="Star rating">
          ${[1, 2, 3, 4, 5].map((n) => `
            <button type="button" data-star="${n}" class="${n <= stars ? 'active' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${n <= stars}">${icon('star', 36)}</button>
          `).join('')}
        </div>
        <div class="error" id="err-stars" hidden style="justify-content:center"></div>
      </div>
      <div class="field">
        <label for="comment">Comments (optional)</label>
        <textarea id="comment" name="comment" maxlength="500" placeholder="Tell us more…">${esc(comment)}</textarea>
        <div class="hint"><span id="comment-count">${comment.length}</span>/500 characters</div>
        <div class="error" id="err-comment" hidden></div>
      </div>
      <div class="footer-bar">
        <a class="btn btn-secondary" href="#/arrival/complete">Skip</a>
        <button type="submit" class="btn btn-primary" id="submit-btn"><span class="label">${existing ? 'Update rating' : 'Submit rating'}</span></button>
      </div>
    </form>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  const form = appEl.querySelector('#rate-form');
  if (!form) return;
  form.querySelectorAll('[data-star]').forEach((btn) => {
    btn.addEventListener('click', () => {
      stars = Number(btn.dataset.star);
      updateStars();
      validateStars();
    });
  });
  const countEl = form.querySelector('#comment-count');
  form.comment.addEventListener('input', () => {
    countEl.textContent = String(form.comment.value.length);
    validateComment();
  });
  form.comment.addEventListener('blur', validateComment);
  form.addEventListener('submit', onSubmit);
}

function updateStars() {
  const form = appEl.querySelector('#rate-form');
  form.querySelectorAll('[data-star]').forEach((btn) => {
    const n = Number(btn.dataset.star);
    const on = n <= stars;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function validateStars() {
  const err = appEl.querySelector('#err-stars');
  if (!err) return true;
  if (!stars || stars < 1) { err.textContent = 'Select a star rating.'; err.hidden = false; return false; }
  err.hidden = true;
  return true;
}

function validateComment() {
  const form = appEl.querySelector('#rate-form');
  const err = appEl.querySelector('#err-comment');
  const val = form.comment.value.trim();
  if (val.length > 500) {
    err.textContent = 'Comment must be 500 characters or fewer.'; err.hidden = false;
    form.comment.setAttribute('aria-invalid', 'true');
    return false;
  }
  err.hidden = true;
  form.comment.removeAttribute('aria-invalid');
  return true;
}

async function onSubmit(e) {
  e.preventDefault();
  const starsOk = validateStars();
  const commentOk = validateComment();
  if (!starsOk || !commentOk) { announce('Please fix the errors in the form.'); return; }
  if (submitting) return;
  submitting = true;
  const form = appEl.querySelector('#rate-form');
  const btn = appEl.querySelector('#submit-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.querySelector('.label').textContent = 'Submitting…';
  try {
    await api.rate({ stars, comment: form.comment.value.trim() });
    if (!mounted) return;
    toast('Thank you for your feedback.', 'success');
    navigate('#/arrival/complete');
  } catch (err) {
    if (!mounted) return;
    submitting = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.querySelector('.label').textContent = existing ? 'Update rating' : 'Submit rating';
    toast(err.message, 'error');
  }
}
