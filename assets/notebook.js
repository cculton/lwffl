/* LWFFL Notebook — the live half of a post page.

   The prose and the OG tags are baked into n/<slug>.html at build time so
   Discord can read them. Everything below renders in the browser from the
   same JSON the rest of the site uses, which is what keeps a recap's numbers
   identical to records.html forever instead of freezing whatever was true the
   day it was written. */

function notebookDivisionStandings(perfs, divisions, year, standingsWeek) {
  if (!Array.isArray(divisions) || !divisions.length) return null;
  const played = perfs.filter(p => p.year === year && p.week <= standingsWeek &&
    (!p.playoffs || p.playoffs === "N/A"));
  if (!played.length) return null;

  const rows = new Map();
  divisions.forEach(division => division.managers.forEach(manager => {
    rows.set(manager, { m: manager, w: 0, l: 0, t: 0, pf: 0, pa: 0 });
  }));
  if (played.some(p => !rows.has(p.manager))) return { missingDivisions: true };

  played.forEach(p => {
    const row = rows.get(p.manager);
    if (p.pf > p.pa) row.w++; else if (p.pf < p.pa) row.l++; else row.t++;
    row.pf += p.pf;
    row.pa += p.pa;
  });

  const pct = r => (r.w + r.t / 2) / (r.w + r.l + r.t || 1);
  const headToHead = (a, b) => {
    const games = played.filter(p => p.manager === a.m && p.opp === b.m);
    if (!games.length) return 0;
    const wins = games.filter(p => p.pf > p.pa).length;
    const ties = games.filter(p => p.pf === p.pa).length;
    return 0.5 - (wins + ties / 2) / games.length;
  };
  const byRecord = (a, b) => pct(b) - pct(a) || b.pf - a.pf ||
    headToHead(a, b) || b.pa - a.pa || a.m.localeCompare(b.m);
  const byPoints = (a, b) => b.pf - a.pf || byRecord(a, b);

  const groups = divisions.map(division => ({
    name: division.name,
    rows: division.managers.map(manager => rows.get(manager)).sort(byRecord)
  }));
  const seeds = new Map();
  groups.map(group => group.rows[0]).sort(byRecord)
    .forEach((row, index) => seeds.set(row.m, index + 1));

  const remaining = [...rows.values()].filter(row => !seeds.has(row.m));
  remaining.sort(byRecord);
  if (remaining[0]) seeds.set(remaining.shift().m, 4);
  remaining.sort(byPoints).slice(0, 2)
    .forEach((row, index) => seeds.set(row.m, index + 5));

  return { through: Math.max(...played.map(p => p.week)), groups, seeds };
}

function notebookPost(article) {
  if (!article) return;

  document.querySelectorAll(".copy-link").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.url);
        const was = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("ok");
        setTimeout(() => { btn.textContent = was; btn.classList.remove("ok"); }, 1600);
      } catch {
        btn.textContent = btn.dataset.url;   /* clipboard blocked — show it to select */
      }
    });
  });

  const year = Number(article.dataset.year);
  const week = article.dataset.week ? Number(article.dataset.week) : null;
  const standingsWeek = Number(article.dataset.standingsWeek ?? week);

  /* Embeds go wherever the author put ::: scoreboard / ::: standings in the
     markdown. If a post asks for neither, the template's trailing
     #dataModule still gets the scoreboard on a recap, so nothing regresses. */
  const embeds = [...article.querySelectorAll("[data-embed]")];
  const tail = document.getElementById("dataModule");
  const wantsTail = !embeds.length &&
    (article.dataset.edition === "recap" || article.dataset.edition === "sunday");
  if (!week || (!embeds.length && !wantsTail)) return;

  Promise.all([
    LWFFL.load(),
    fetch("../data/notebook-divisions.json")
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({}))
  ]).then(([M, divisionsByYear]) => {
    const { fmt, mlink, bxlink, recordStr } = LWFFL;

    function scoreboard() {
      const matchups = M.games.filter(g => g.year === year && g.week === week);
      if (!matchups.length) return "";

      const perfs = matchups.flatMap(g => ([
        { m: g.manager1, pf: g.score1 }, { m: g.manager2, pf: g.score2 }
      ]));
      const high = perfs.slice().sort((a, b) => b.pf - a.pf)[0];
      const low = perfs.slice().sort((a, b) => a.pf - b.pf)[0];
      const closest = matchups.slice()
        .sort((a, b) => Math.abs(a.score1 - a.score2) - Math.abs(b.score1 - b.score2))[0];

      const ranked = M.perfs
        .filter(p => p.year < year || (p.year === year && p.week <= week))
        .slice().sort((a, b) => b.pf - a.pf);
      const highRank = ranked.findIndex(p =>
        p.year === year && p.week === week && p.pf === high.pf) + 1;

      const row = g => {
        const w1 = g.score1 > g.score2;
        return `
          <div class="nb-matchup">
            <div class="nb-team ${w1 ? "won" : ""}">${mlink(g.manager1)}</div>
            <div class="nb-score ${w1 ? "won" : ""}">${bxlink(g.year, g.week, g.manager1, fmt(g.score1, 2))}</div>
            <div class="nb-vs">–</div>
            <div class="nb-score ${!w1 ? "won" : ""}">${bxlink(g.year, g.week, g.manager2, fmt(g.score2, 2))}</div>
            <div class="nb-team ${!w1 ? "won" : ""}">${mlink(g.manager2)}</div>
          </div>`;
      };

      return `
        <div class="section-label">Week ${week} results</div>
        <div class="card">
          <div class="nb-matchups">${matchups.map(row).join("")}</div>
          <div class="nb-notes">
            <div><span class="nb-k">High</span> ${mlink(high.m)} · <strong>${fmt(high.pf, 2)}</strong>${
              highRank && highRank <= 25 ? ` <span class="pill gold">#${highRank} all time</span>` : ""}</div>
            <div><span class="nb-k">Low</span> ${mlink(low.m)} · <strong>${fmt(low.pf, 2)}</strong></div>
            <div><span class="nb-k">Closest</span> ${mlink(closest.score1 > closest.score2 ? closest.manager1 : closest.manager2)}
              by <strong>${fmt(Math.abs(closest.score1 - closest.score2), 2)}</strong></div>
          </div>
        </div>`;
    }

    function standings() {
      const snapshot = notebookDivisionStandings(
        M.perfs, divisionsByYear[String(year)], year, standingsWeek);
      if (!snapshot) return "";
      if (snapshot.missingDivisions) return '<div class="card">Division standings are temporarily unavailable.</div>';
      const esc = value => String(value).replace(/[&<>"']/g, char =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      return `
        <div class="section-label">Standings through week ${snapshot.through}</div>
        <p class="nb-standings-note"><span class="nb-playoff-key" aria-hidden="true"></span>
          Shaded rows are projected playoff spots if the season ended here.</p>
        ${snapshot.groups.map(group => `
          <section class="nb-division">
            <h3 class="nb-division-name">${esc(group.name)}</h3>
            <div class="table-card post-table"><div class="table-scroll"><table>
              <thead><tr><th scope="col">#</th><th scope="col">Manager</th><th scope="col" class="num">Record</th><th scope="col" class="num">PF</th></tr></thead>
              <tbody>${group.rows.map((r, i) => {
                const seed = snapshot.seeds.get(r.m);
                return `<tr${seed ? ' class="nb-playoff-row"' : ""}>
                  <td class="nb-division-rank">${i + 1}</td>
                  <td><span class="nb-manager-cell">${mlink(r.m)}${seed ?
                    `<span class="nb-seed" aria-label="Projected playoff seed ${seed}">#${seed}</span>` : ""}</span></td>
                  <td class="num">${recordStr(r.w, r.l, r.t)}</td>
                  <td class="num">${fmt(r.pf, 1)}</td></tr>`;
              }).join("")}</tbody>
            </table></div></div>
          </section>`).join("")}`;
    }

    const render = { scoreboard, standings };
    embeds.forEach(el => {
      const html = (render[el.dataset.embed] || (() => ""))();
      if (html) el.outerHTML = html; else el.remove();
    });
    if (wantsTail && tail) tail.innerHTML = scoreboard();
  }).catch(() => { /* a post still reads fine without the modules */ });
}

/* ---------- the feed ---------- */

function notebookFeed(el) {
  const EDITION = {
    announcement: { label: "Announcement", cls: "ed-ann" },
    preview: { label: "Preview", cls: "ed-pre" },
    sunday: { label: "Sunday Update", cls: "ed-sun" },
    recap: { label: "Recap", cls: "ed-rec" }
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const when = d => new Date(d + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return fetch("notebook-index.json").then(r => r.json()).then(idx => {
    const posts = idx.posts || [];
    const pinned = posts.filter(p => p.pinned);
    const feed = posts.filter(p => !p.pinned);

    const card = (p, big) => {
      const ed = EDITION[p.edition] || EDITION.announcement;
      return `
        <a class="card nb-card${big ? " nb-lead" : ""}" href="n/${p.slug}.html">
          <div class="nb-kicker">
            <span class="nb-ed ${ed.cls}">${ed.label}</span>
            ${p.week ? `<span class="nb-wk">Week ${p.week}</span>` : ""}
            <span class="nb-date">${when(p.date)}</span>
            ${p.sample ? '<span class="pill">Sample</span>' : ""}
          </div>
          <div class="nb-title">${esc(p.title)}</div>
          <div class="nb-dek">${esc(p.dek)}</div>
        </a>`;
    };

    const years = [...new Set(feed.map(p => p.year))].sort((a, b) => b - a);

    el.innerHTML = `
      ${pinned.length ? `
        <div class="section-label" style="margin-top:0">Pinned</div>
        <div class="nb-grid">${pinned.map(p => card(p)).join("")}</div>` : ""}

      <div class="section-label">Latest</div>
      <div class="ctrl-row">
        <div><label class="field-label" for="nbY">Season</label>
          <select id="nbY"><option value="">All seasons</option>
            ${years.map(y => `<option value="${y}">${y}</option>`).join("")}</select></div>
        <div style="flex:1 1 240px"><label class="field-label">Edition</label>
          <div class="pill-group" id="nbT"></div></div>
      </div>
      <div id="nbList"></div>`;

    const picked = multiPills(document.getElementById("nbT"),
      ["preview", "sunday", "recap", "announcement"], apply, v => EDITION[v].label);

    function apply() {
      const y = document.getElementById("nbY").value;
      const rows = feed.filter(p =>
        (!y || String(p.year) === y) && (!picked.size || picked.has(p.edition)));
      document.getElementById("nbList").innerHTML = rows.length
        ? `${rows.slice(0, 1).map(p => card(p, true)).join("")}
           <div class="nb-grid" style="margin-top:14px">${rows.slice(1).map(p => card(p)).join("")}</div>`
        : `<div class="card" style="text-align:center;color:var(--soft);padding:34px">
             Nothing here yet for those filters.</div>`;
    }
    document.getElementById("nbY").addEventListener("change", apply);
    apply();
  });
}
