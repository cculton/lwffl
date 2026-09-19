#!/usr/bin/env node
/**
 * Builds the LWFFL Notebook — league announcements, previews and recaps.
 *
 *   node scripts/build-notebook.mjs
 *
 * Reads  data/notebook/*.md   (YAML-ish frontmatter + markdown body)
 * Writes n/<slug>.html        one real page per post
 *        n/cards/<slug>.html  share-card template, 1200x630
 *        n/<slug>.txt         teaser ready to paste into Discord
 *        notebook-index.json  the feed
 *
 * WHY ONE FILE PER POST. Every other page on this site renders client-side
 * from JSON, which is fine for people and useless for Discord: its link
 * unfurler fetches the HTML and reads the <meta> tags WITHOUT running any
 * JavaScript. A client-rendered post would show the same generic card for
 * every link ever posted. So each post gets a real file with its own
 * og:title / og:description / og:image baked into the served HTML.
 *
 * The prose and the meta tags are static. The data modules under them —
 * final scores, matchup lines, record watch — still render client-side from
 * the same JSON the rest of the site uses, so the numbers can never drift
 * from records.html and stay right years later. Discord only reads the head,
 * so it never notices the difference.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "data", "notebook");
const OUT = path.join(root, "n");
const SITE = "https://lwffl.com";

const EDITIONS = {
  announcement: { label: "Announcement", icon: "📣" },
  preview:      { label: "Preview",      icon: "🔮" },
  sunday:       { label: "Sunday Update", icon: "📡" },
  recap:        { label: "Recap",        icon: "📝" }
};

const esc = s => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- frontmatter ---------- */

function parse(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${path.basename(file)}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^\d+$/.test(v)) v = Number(v);
    else if (v.startsWith("[") && v.endsWith("]")) v = JSON.parse(v);
    meta[kv[1]] = v;
  }
  return { meta, body: m[2].trim() };
}

/* ---------- markdown, deliberately small ---------- */

/* Escapes first, then marks up, so a post can never inject markup into the
   page. Supports what a league write-up actually uses and nothing else. */
function markdown(src) {
  const inline = t => esc(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const block of src.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    if (/^###\s/.test(b)) { closeList(); out.push(`<h3>${inline(b.slice(4))}</h3>`); continue; }
    if (/^##\s/.test(b))  { closeList(); out.push(`<h2>${inline(b.slice(3))}</h2>`); continue; }
    if (/^>\s/.test(b)) {
      closeList();
      out.push(`<blockquote>${inline(b.replace(/^>\s?/gm, ""))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s/.test(b)) {
      closeList(); list = "ul"; out.push("<ul>");
      for (const li of b.split("\n")) out.push(`<li>${inline(li.replace(/^[-*]\s+/, ""))}</li>`);
      closeList(); continue;
    }
    if (/^\d+\.\s/.test(b)) {
      closeList(); list = "ol"; out.push("<ol>");
      for (const li of b.split("\n")) out.push(`<li>${inline(li.replace(/^\d+\.\s+/, ""))}</li>`);
      closeList(); continue;
    }
    closeList();
    out.push(`<p>${inline(b).replace(/\n/g, "<br>")}</p>`);
  }
  closeList();
  return out.join("\n");
}

/* ---------- share card (rasterise separately; see render-cards) ---------- */

function cardHtml(p) {
  const ed = EDITIONS[p.edition] || EDITIONS.announcement;
  const kicker = p.week ? `${ed.label} · ${p.year} Week ${p.week}` : `${ed.label} · ${p.year}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#060a14;color:#e8ecf4;
       font-family:Inter,system-ui,sans-serif;position:relative;overflow:hidden}
  body::before{content:"";position:absolute;inset:0;
    background:radial-gradient(ellipse 70% 55% at 10% -10%,rgba(0,133,202,.30),transparent),
               radial-gradient(ellipse 60% 50% at 100% 15%,rgba(129,140,248,.22),transparent)}
  .in{position:relative;padding:72px 80px;height:100%;display:flex;flex-direction:column}
  .brand{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:.05em}
  .brand span{color:#0085CA}
  .kick{margin-top:auto;font-size:22px;font-weight:700;letter-spacing:.16em;
        text-transform:uppercase;color:#0085CA}
  h1{font-family:'Space Grotesk',sans-serif;font-size:${p.title.length > 64 ? 56 : 68}px;
     font-weight:700;line-height:1.1;margin:18px 0 0;letter-spacing:-.01em}
  .dek{margin-top:22px;font-size:26px;line-height:1.45;color:#94a3b8;
       display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .rule{margin-top:34px;height:5px;width:130px;border-radius:3px;
        background:linear-gradient(90deg,#0085CA,#818cf8)}
</style></head><body><div class="in">
  <div class="brand"><span>LW</span>FFL · Notebook</div>
  <div class="kick">${esc(kicker)}</div>
  <h1>${esc(p.title)}</h1>
  <div class="dek">${esc(p.dek)}</div>
  <div class="rule"></div>
</div></body></html>`;
}

/* ---------- post page ---------- */

function postHtml(p, bodyHtml) {
  const ed = EDITIONS[p.edition] || EDITIONS.announcement;
  const url = `${SITE}/n/${p.slug}.html`;
  const when = new Date(`${p.date}T12:00:00`).toLocaleDateString("en-US",
    { month: "long", day: "numeric", year: "numeric" });
  const kicker = p.week ? `${ed.label} · Week ${p.week}` : ed.label;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(p.title)} — LWFFL Notebook</title>

  <!-- Discord and iMessage read these without running JS. This is the whole
       reason each post is a real file instead of a client-rendered route. -->
  <meta name="description" content="${esc(p.dek)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="LWFFL Notebook" />
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(p.dek)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${SITE}/n/cards/${p.slug}.png" />
  <meta property="article:published_time" content="${p.date}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#0085CA" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>

<nav class="topnav">
  <div class="nav-inner">
    <a class="brand" href="../index.html"><span>LW</span>FFL</a>
    <div class="nav-links">
      <a href="../index.html">Home</a>
      <a href="../notebook.html" class="active">Notebook</a>
      <a href="../managers.html">Managers</a>
      <a href="../seasons.html">Seasons</a>
      <a href="../boxscores.html">Scores</a>
      <a href="../transactions.html">Transactions</a>
      <a href="../h2h.html">H2H</a>
      <a href="../draft.html">Draft</a>
      <a href="../explorer.html">Stat Lab</a>
      <a href="../records.html">Records</a>
      <a href="../arcade.html">Arcade</a>
      <a href="../league.html">Constitution</a>
    </div>
  </div>
</nav>

<div class="wrap wrap-read">
  <a class="back-link" href="../notebook.html">← The Notebook</a>

  <article class="post" data-edition="${esc(p.edition)}" data-year="${p.year}"${p.week ? ` data-week="${p.week}"` : ""}>
    <header class="post-head">
      <div class="post-kicker">${esc(kicker)}</div>
      <h1>${esc(p.title)}</h1>
      <p class="post-dek">${esc(p.dek)}</p>
      <div class="post-meta">
        <span>${esc(when)}</span><span class="dot">·</span>
        <span>${esc(p.author || "Commissioner")}</span>
        ${p.sample ? '<span class="pill" style="margin-left:6px">Sample post</span>' : ""}
        <button type="button" class="copy-link" data-url="${url}">Copy link</button>
      </div>
    </header>

    <div class="post-body">
${bodyHtml}
    </div>

    <!-- filled client-side from the same JSON the rest of the site uses -->
    <div id="dataModule"></div>
  </article>
</div>

<footer class="footer">
  LWFFL · Legion of Whom Fantasy Football League
</footer>

<script>window.LWFFL_BASE = "../";</script>
<script src="../assets/data.js?v=2"></script>
<script src="../assets/notebook.js?v=1"></script>
<script>notebookPost(document.querySelector(".post"));</script>
</body>
</html>
`;
}

/* ---------- teaser for the group chat ---------- */

function teaser(p) {
  const ed = EDITIONS[p.edition] || EDITIONS.announcement;
  const head = p.week ? `${ed.icon} **${ed.label} — Week ${p.week}**` : `${ed.icon} **${ed.label}**`;
  return `${head}\n${p.title}\n\n${p.dek}\n\n${SITE}/n/${p.slug}.html\n`;
}

/* ---------- house style: first names only ---------- */

/* The site shows managers by first name everywhere (LWFFL.shortName in
   assets/data.js) — Ryans disambiguated by surname initial, Tom as Thomas.
   A post that says "Stuart Sundseth" or just "Sundseth" reads as a different
   person from the "Stuart" on every other page, so the build refuses it.
   Roster comes from final-standings.json, so a new manager is covered the
   moment they appear in the data. */
const MANAGERS = [...new Set(
  JSON.parse(fs.readFileSync(path.join(root, "final-standings.json"), "utf8"))
    .map(r => r.manager).filter(Boolean)
)];

const shortName = name => {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] === "Tom" ? "Thomas" : parts[0];
  if (first !== "Ryan" || parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1][0]}.`;
};

function styleErrors(p) {
  const text = [p.title, p.dek, p.body, p.author].filter(Boolean).join("\n");
  const bad = [];
  for (const full of MANAGERS) {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const surname = parts[parts.length - 1];
    if (new RegExp(`\\b${full}\\b`).test(text)) {
      bad.push(`"${full}" -> "${shortName(full)}"`);
    } else if (new RegExp(`\\b${surname}\\b`).test(text)) {
      bad.push(`"${surname}" -> "${shortName(full)}"`);
    }
  }
  return bad;
}

/* ---------- build ---------- */

fs.mkdirSync(path.join(OUT, "cards"), { recursive: true });

const posts = fs.readdirSync(SRC).filter(f => f.endsWith(".md")).map(f => {
  const { meta, body } = parse(path.join(SRC, f));
  for (const k of ["slug", "edition", "year", "title", "dek", "date"]) {
    if (meta[k] == null) throw new Error(`${f}: missing "${k}"`);
  }
  if (!EDITIONS[meta.edition]) throw new Error(`${f}: unknown edition "${meta.edition}"`);
  const post = { ...meta, body };
  const bad = styleErrors(post);
  if (bad.length) {
    throw new Error(`${f}: use the first names the rest of the site uses — ` + bad.join(", "));
  }
  return post;
});

posts.sort((a, b) => b.date.localeCompare(a.date) || (b.week || 0) - (a.week || 0));

for (const p of posts) {
  fs.writeFileSync(path.join(OUT, `${p.slug}.html`), postHtml(p, markdown(p.body)));
  fs.writeFileSync(path.join(OUT, "cards", `${p.slug}.html`), cardHtml(p));
  fs.writeFileSync(path.join(OUT, `${p.slug}.txt`), teaser(p));
}

fs.writeFileSync(path.join(root, "notebook-index.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  posts: posts.map(p => ({
    slug: p.slug, edition: p.edition, year: p.year, week: p.week ?? null,
    title: p.title, dek: p.dek, date: p.date,
    author: p.author || "Commissioner",
    pinned: !!p.pinned, sample: !!p.sample
  }))
}) + "\n");

console.log(`${posts.length} posts -> n/*.html, n/cards/*.html, n/*.txt, notebook-index.json`);
for (const p of posts) console.log(`  ${p.date}  ${p.edition.padEnd(12)} ${p.slug}`);
