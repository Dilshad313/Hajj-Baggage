/**
 * Minimal hash router: #/route/:param, with guards and a 404 view.
 */

/** @type {{pattern:string, segments:string[], render:(params:object)=>void, destroy?:()=>void}[]} */
const routes = [];
let current = null; // { render, destroy }
let guard = null;
let notFoundRender = null;

/** @param {string} pattern e.g. "/users/:id" @param {(params:object, render:(p)=>void)=>void} handler */
export function route(pattern, handler) {
  routes.push({ pattern, segments: pattern.split('/').filter(Boolean), handler });
}

/** @param {() => (boolean|string)} fn return false/redirect-hash to block navigation */
export function setGuard(fn) { guard = fn; }

/** @param {() => void} fn */
export function setNotFound(fn) { notFoundRender = fn; }

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = hash.split('?');
  const query = {};
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { path: path || '/', query };
}

function matchRoute(path) {
  const pathSegs = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.segments.length !== pathSegs.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < r.segments.length; i++) {
      const seg = r.segments[i];
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(pathSegs[i]);
      else if (seg !== pathSegs[i]) { matched = false; break; }
    }
    if (matched) return { route: r, params };
  }
  return null;
}

async function resolve() {
  const { path, query } = parseHash();
  if (guard) {
    const result = guard(path);
    if (result === false) return;
    if (typeof result === 'string') {
      location.hash = result;
      return;
    }
  }
  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { /* ignore */ }
  }
  current = null;

  const app = document.getElementById('app');
  const match = matchRoute(path);
  if (!match) {
    if (notFoundRender) notFoundRender(app);
    resetScrollAndFocus(app);
    return;
  }
  const params = { ...match.params, ...query };
  const result = match.route.handler(params, app);
  current = result || null;
  resetScrollAndFocus(app);
}

function resetScrollAndFocus(app) {
  window.scrollTo({ top: 0 });
  if (app) {
    app.setAttribute('tabindex', '-1');
    app.focus({ preventScroll: true });
  }
}

/** Starts listening to hash changes and performs the initial route resolution. */
export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

/** @param {string} hash e.g. "#/users" */
export function navigate(hash) {
  if (location.hash === hash) resolve();
  else location.hash = hash;
}

/** @returns {{render:Function, destroy?:Function, poll?:Function}|null} the currently mounted route controller */
export function getCurrent() { return current; }
