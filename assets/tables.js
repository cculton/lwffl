/* LWFFL v2 — sortable/paginated data table engine.
   Every column is click-to-sort; pagination optional; rows swappable
   via .update() so filter controls can re-feed the same table. */

function dataTable(el, cfg) {
  const state = {
    key: cfg.initialSort ? cfg.initialSort.key : null,
    dir: cfg.initialSort ? (cfg.initialSort.dir || "desc") : "desc",
    page: 1
  };

  const getter = col => col.get || (r => r[col.key]);

  function sortedRows() {
    const rows = cfg.rows.slice();
    if (!state.key) return rows;
    const col = cfg.columns.find(c => c.key === state.key);
    if (!col) return rows;
    const get = getter(col);
    rows.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return state.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }

  function render() {
    const rows = sortedRows();
    const total = rows.length;
    let pageRows = rows;
    let totalPages = 1;
    if (cfg.pageSize) {
      totalPages = Math.max(1, Math.ceil(total / cfg.pageSize));
      state.page = Math.min(state.page, totalPages);
      pageRows = rows.slice((state.page - 1) * cfg.pageSize, state.page * cfg.pageSize);
    }

    const startRank = cfg.pageSize ? (state.page - 1) * cfg.pageSize : 0;

    const head = cfg.columns.map(c => {
      const sorted = state.key === c.key;
      const arrow = sorted ? (state.dir === "asc" ? " ↑" : " ↓") : "";
      return `<th class="${c.num ? "num " : ""}sortable${sorted ? " sorted" : ""}" data-key="${c.key}" title="Click to sort">${c.label}${arrow}</th>`;
    }).join("");

    const body = pageRows.map((r, i) => {
      const cells = cfg.columns.map(c => {
        const val = c.render ? c.render(r, startRank + i + 1) : getter(c)(r);
        return `<td class="${c.num ? "num" : ""}${state.key === c.key ? " sorted-cell" : ""}">${val ?? "—"}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    el.innerHTML = `
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body || `<tr><td colspan="${cfg.columns.length}" style="text-align:center;color:var(--soft);padding:28px">No rows match these filters.</td></tr>`}</tbody>
          </table>
        </div>
        ${cfg.pageSize && totalPages > 1 ? `
          <div class="tbl-foot">
            <button type="button" data-pg="-1" ${state.page <= 1 ? "disabled" : ""}>← Prev</button>
            <span>Page ${state.page} of ${totalPages} · ${total.toLocaleString()} rows</span>
            <button type="button" data-pg="1" ${state.page >= totalPages ? "disabled" : ""}>Next →</button>
          </div>` : ""}
        ${cfg.footer ? `<div class="tbl-note">${cfg.footer(rows)}</div>` : ""}
      </div>`;

    el.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (state.key === k) {
        state.dir = state.dir === "asc" ? "desc" : "asc";
      } else {
        state.key = k;
        const col = cfg.columns.find(c => c.key === k);
        state.dir = (col && col.dir) || "desc";
      }
      state.page = 1;
      render();
    }));

    el.querySelectorAll("[data-pg]").forEach(b => b.addEventListener("click", () => {
      state.page += Number(b.dataset.pg);
      render();
    }));
  }

  render();
  return {
    update(rows) { cfg.rows = rows; state.page = 1; render(); },
    setSort(key, dir) { state.key = key; state.dir = dir; state.page = 1; render(); }
  };
}

/* Populate a <select> with options; first option provided by caller in HTML. */
function fillSelect(sel, values) {
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

/* Same, but display privacy-friendly short names while keeping full names as values. */
function fillSelectNames(sel, names) {
  names.forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = LWFFL.shortName(n);
    sel.appendChild(o);
  });
}

/* Build a pill-based multi-select. Returns the live Set of selected values.
   container: a DOM element to render pills into.
   values: array of string values.
   onChange: called with no args whenever selection changes.
   labelFn: optional function(value) -> display string. */
function multiPills(container, values, onChange, labelFn) {
  const sel = new Set();
  container.innerHTML = values.map(v =>
    `<button type="button" class="filter-pill" data-v="${v}">${labelFn ? labelFn(v) : v}</button>`
  ).join("");
  container.addEventListener("click", e => {
    const btn = e.target.closest(".filter-pill");
    if (!btn) return;
    const v = btn.dataset.v;
    if (sel.has(v)) sel.delete(v); else sel.add(v);
    btn.classList.toggle("on", sel.has(v));
    onChange();
  });
  return sel;
}
