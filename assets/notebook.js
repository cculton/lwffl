/* LWFFL Notebook — the live half of a post page.

   The prose and the OG tags are baked into n/<slug>.html at build time so
   Discord can read them. Everything below renders in the browser from the
   same JSON the rest of the site uses, which is what keeps a recap's numbers
   identical to records.html forever instead of freezing whatever was true the
   day it was written. */

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

  const edition = article.dataset.edition;
  const year = Number(article.dataset.year);
  const week = article.dataset.week ? Number(article.dataset.week) : null;
  if (!week || (edition !== "recap" && edition !== "sunday")) return;

  const box = document.getElementById("dataModule");
  if (!box) return;

  LWFFL.load().then(M => {
    const games = M.games.filter(g => g.year === year && g.week === week);
    if (!games.length) return;
    const { fmt, mlink, bxlink, wlink } = LWFFL;

    const perfs = games.flatMap(g => ([
      { m: g.manager1, pf: g.score1, opp: g.manager2, pa: g.score2 },
      { m: g.manager2, pf: g.score2, opp: g.manager1, pa: g.score1 }
    ]));
    const high = perfs.slice().sort((a, b) => b.pf - a.pf)[0];
    const low = perfs.slice().sort((a, b) => a.pf - b.pf)[0];
    const closest = games.slice()
      .sort((a, b) => Math.abs(a.score1 - a.score2) - Math.abs(b.score1 - b.score2))[0];

    /* does anything this week belong in the record book? */
    const allPerfs = M.perfs.filter(p => p.year < year || (p.year === year && p.week <= week));
    const ranked = allPerfs.slice().sort((a, b) => b.pf - a.pf);
    const highRank = ranked.findIndex(p => p.year === year && p.week === week && p.pf === high.pf) + 1;

    const row = g => {
      const w1 = g.score1 > g.score2;
      return `
        <div class="nb-game">
          <div class="nb-team ${w1 ? "won" : ""}">${mlink(g.manager1)}</div>
          <div class="nb-score ${w1 ? "won" : ""}">${bxlink(g.year, g.week, g.manager1, fmt(g.score1, 2))}</div>
          <div class="nb-vs">–</div>
          <div class="nb-score ${!w1 ? "won" : ""}">${bxlink(g.year, g.week, g.manager2, fmt(g.score2, 2))}</div>
          <div class="nb-team ${!w1 ? "won" : ""}">${mlink(g.manager2)}</div>
        </div>`;
    };

    box.innerHTML = `
      <div class="section-label">Week ${week} results</div>
      <div class="card">
        <div class="nb-games">${games.map(row).join("")}</div>
        <div class="nb-notes">
          <div><span class="nb-k">High</span> ${mlink(high.m)} · <strong>${fmt(high.pf, 2)}</strong>${
            highRank && highRank <= 25 ? ` <span class="pill gold">#${highRank} all time</span>` : ""}</div>
          <div><span class="nb-k">Low</span> ${mlink(low.m)} · <strong>${fmt(low.pf, 2)}</strong></div>
          <div><span class="nb-k">Closest</span> ${mlink(closest.score1 > closest.score2 ? closest.manager1 : closest.manager2)}
            by <strong>${fmt(Math.abs(closest.score1 - closest.score2), 2)}</strong></div>
        </div>
        <div class="tbl-note" style="border-top:1px solid var(--border);margin-top:14px">
          Pulled live from the league's box scores — these figures move with
          ${wlink(year, week, "the week " + week + " scoreboard")}, they are not typed into the post.
        </div>
      </div>`;
  }).catch(() => { /* a post still reads fine without the module */ });
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
