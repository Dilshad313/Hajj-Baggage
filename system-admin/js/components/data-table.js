import { esc, toCsv, downloadBlob } from '../ui.js';

/**
 * Renders a sortable, paginated, searchable data table into `container`.
 * @param {HTMLElement} container
 * @param {{
 *   columns: {key:string, label:string, sortable?:boolean, render?:(row:object)=>string, csvValue?:(row:object)=>string|number}[],
 *   rows: object[],
 *   pageSize?: number,
 *   searchKeys?: string[],
 *   getRowId?: (row:object)=>string,
 *   onRowClick?: (row:object)=>void,
 *   csvFilename?: string,
 *   emptyMessage?: string,
 *   toolbarExtraHtml?: string,
 *   selectable?: boolean,
 *   onSelectionChange?: (ids:string[])=>void,
 * }} opts
 * @returns {{ setRows:(rows:object[])=>void, getSelected:()=>string[], clearSelection:()=>void, destroy:()=>void }}
 */
export function createDataTable(container, opts) {
  const pageSize = opts.pageSize || 25;
  let rows = opts.rows || [];
  let sortKey = null;
  let sortDir = 'asc';
  let page = 1;
  let query = '';
  const selected = new Set();

  function filtered() {
    let list = rows;
    if (query && opts.searchKeys) {
      const q = query.toLowerCase();
      list = list.filter((r) => opts.searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }

  let bodyEl = null;

  /** Builds the toolbar once; it's never torn down, so externally-wired listeners on `toolbarExtraHtml` controls survive every re-render. */
  function renderShell() {
    container.innerHTML = `
      <div class="table-toolbar">
        <input type="search" placeholder="Search…" aria-label="Search table" value="${esc(query)}" data-tbl="search" />
        ${opts.toolbarExtraHtml || ''}
        <span class="fs-sm muted" data-tbl="selected-count" hidden></span>
        <span class="grow"></span>
        <button type="button" class="btn btn-secondary" data-tbl="export">Export CSV</button>
      </div>
      <div data-tbl="body"></div>`;
    bodyEl = container.querySelector('[data-tbl="body"]');
    bindToolbar();
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const el = container.querySelector('[data-tbl="selected-count"]');
    if (!el) return;
    el.hidden = selected.size === 0;
    el.textContent = `${selected.size} selected`;
  }

  function renderBody() {
    const list = filtered();
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, totalPages);
    const pageRows = list.slice((page - 1) * pageSize, page * pageSize);
    updateSelectedCount();

    if (!list.length) {
      bodyEl.innerHTML = `
        <div class="state-block empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
          <p>${esc(opts.emptyMessage || 'No matching records.')}</p>
        </div>`;
      return;
    }

    const allOnPageSelected = opts.selectable && pageRows.length > 0 && pageRows.every((r) => selected.has(opts.getRowId(r)));
    const theadCells = (opts.selectable ? `<th scope="col" style="width:36px"><input type="checkbox" aria-label="Select all rows on this page" data-tbl="select-all" ${allOnPageSelected ? 'checked' : ''} /></th>` : '') +
      opts.columns.map((c) => {
        if (!c.sortable) return `<th scope="col">${esc(c.label)}</th>`;
        const sort = sortKey === c.key ? sortDir : 'none';
        const ariaSort = sort === 'none' ? 'none' : sort === 'asc' ? 'ascending' : 'descending';
        return `<th scope="col" aria-sort="${ariaSort}"><button type="button" data-tbl-sort="${c.key}">${esc(c.label)} ${sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button></th>`;
      }).join('');

    const bodyRows = pageRows.map((row) => {
      const id = opts.getRowId ? opts.getRowId(row) : '';
      const checkTd = opts.selectable ? `<td><input type="checkbox" aria-label="Select row" data-tbl-select="${esc(id)}" ${selected.has(id) ? 'checked' : ''} /></td>` : '';
      const tds = opts.columns.map((c) => `<td data-label="${esc(c.label)}">${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('');
      return `<tr data-row-id="${esc(id)}" tabindex="0" role="button">${checkTd}${tds}</tr>`;
    }).join('');

    bodyEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>${theadCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
        <div class="table-pagination">
          <span>${list.length} record${list.length === 1 ? '' : 's'} · page ${page} of ${totalPages}</span>
          <div class="row gap-2">
            <button type="button" class="btn btn-secondary btn-icon" data-tbl="prev" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
            <button type="button" class="btn btn-secondary btn-icon" data-tbl="next" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">›</button>
          </div>
        </div>
      </div>`;
    bindBody(pageRows);
  }

  function bindToolbar() {
    container.querySelector('[data-tbl="search"]').addEventListener('input', (e) => {
      query = e.target.value; page = 1; renderBody();
    });
    container.querySelector('[data-tbl="export"]').addEventListener('click', () => {
      const list = filtered();
      const csvRows = list.map((r) => {
        const out = {};
        for (const c of opts.columns) out[c.label] = c.csvValue ? c.csvValue(r) : r[c.key];
        return out;
      });
      const csv = toCsv(csvRows, opts.columns.map((c) => c.label));
      downloadBlob(`${opts.csvFilename || 'export'}.csv`, csv, 'text/csv');
    });
  }

  function bindBody(pageRows) {
    bodyEl.querySelectorAll('[data-tbl-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.tblSort;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        renderBody();
      });
    });
    bodyEl.querySelector('[data-tbl="prev"]')?.addEventListener('click', () => { page -= 1; renderBody(); });
    bodyEl.querySelector('[data-tbl="next"]')?.addEventListener('click', () => { page += 1; renderBody(); });
    if (opts.onRowClick) {
      bodyEl.querySelectorAll('tbody tr').forEach((tr) => {
        const row = rows.find((r) => (opts.getRowId ? opts.getRowId(r) : '') === tr.dataset.rowId);
        const activate = () => row && opts.onRowClick(row);
        tr.addEventListener('click', (e) => { if (e.target.closest('input[type="checkbox"]')) return; activate(); });
        tr.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('input[type="checkbox"]')) { e.preventDefault(); activate(); } });
      });
    }
    if (opts.selectable) {
      bodyEl.querySelector('[data-tbl="select-all"]')?.addEventListener('change', (e) => {
        for (const row of pageRows) {
          const id = opts.getRowId(row);
          if (e.target.checked) selected.add(id); else selected.delete(id);
        }
        renderBody();
        opts.onSelectionChange?.(Array.from(selected));
      });
      bodyEl.querySelectorAll('[data-tbl-select]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = cb.dataset.tblSelect;
          if (cb.checked) selected.add(id); else selected.delete(id);
          renderBody();
          opts.onSelectionChange?.(Array.from(selected));
        });
      });
    }
  }

  renderShell();
  renderBody();

  return {
    setRows(newRows) { rows = newRows; page = 1; renderBody(); },
    getSelected() { return Array.from(selected); },
    clearSelection() { selected.clear(); renderBody(); },
    destroy() { container.innerHTML = ''; },
  };
}
