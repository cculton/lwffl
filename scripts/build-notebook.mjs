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
  let key = null;
  let value = "";
  const finish = () => {
    if (!key) return;
    let v = value.trim();
    // YAML wraps long plain strings onto indented continuation lines.
    // Pages CMS does this for summaries, which must remain complete in
    // the Notebook index and social preview metadata.
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (v === "null") v = null;
    else if (/^\d+$/.test(v)) v = Number(v);
    else if (v.startsWith("[") && v.endsWith("]")) v = JSON.parse(v);
    meta[key] = v;
  };
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      finish();
      [key, value] = [kv[1], kv[2]];
    } else if (key && /^\s+\S/.test(line)) {
      if (/^[>|][-+]?$/.test(value.trim())) value = "";
      value += `${value ? " " : ""}${line.trim()}`;
    }
  }
  finish();
  return { meta, body: m[2].trim() };
}

/* ---------- markdown + league blocks ---------- */

/* Prose is ordinary markdown. Anything richer is a fenced block:
 *
 *   ::: stat 138.30 | Stuart | highest opening week since 2021
 *   ::: stats            (one "value | label | note" per line)
 *   ::: pull             (a pull quote, bigger than a blockquote)
 *   ::: note             (an aside)
 *   ::: scoreboard       (that week's finals, rendered from the box scores)
 *   ::: standings        (the table as it stood after that week)
 *
 * The two embeds emit an empty div with a data-embed attribute and are filled
 * client-side by assets/notebook.js, so the author places them mid-post
 * rather than accepting whatever the template appends at the end — and the
 * numbers still come from the league's own JSON, never typed into the post.
 */

function markdown(src) {
  const inline = t => esc(t)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
      '<img class="pb-inline-img" loading="lazy" alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  /* pull the fenced blocks out first so their contents never hit the
     paragraph splitter */
  const blocks = [];
  src = src.replace(/^::: *(\w+)([^\n]*)\n([\s\S]*?)^:::[ \t]*$/gm,
    (_, kind, args, inner) => {
      blocks.push(renderBlock(kind, args.trim(), inner.trim(), inline));
      return `\n\n\u0000BLOCK${blocks.length - 1}\u0000\n\n`;
    });

  const out = [];
  let first = true;
  for (const block of src.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    const ph = /^\u0000BLOCK(\d+)\u0000$/.exec(b);
    if (ph) { out.push(blocks[Number(ph[1])]); continue; }
    if (/^###\s/.test(b)) { out.push(`<h3>${inline(b.slice(4))}</h3>`); continue; }
    if (/^##\s/.test(b))  { out.push(`<h2>${inline(b.slice(3))}</h2>`); continue; }
    if (/^\|/.test(b))    { out.push(table(b, inline)); continue; }
    if (/^>\s/.test(b)) {
      out.push(`<blockquote>${inline(b.replace(/^>\s?/gm, ""))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s/.test(b)) {
      out.push("<ul>" + b.split("\n")
        .map(li => `<li>${inline(li.replace(/^[-*]\s+/, ""))}</li>`).join("") + "</ul>");
      continue;
    }
    if (/^\d+\.\s/.test(b)) {
      out.push("<ol>" + b.split("\n")
        .map(li => `<li>${inline(li.replace(/^\d+\.\s+/, ""))}</li>`).join("") + "</ol>");
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(b);
    if (img) {
      out.push(`<figure class="pb-fig"><img loading="lazy" alt="${esc(img[1])}" src="${esc(img[2])}">${
        img[1] ? `<figcaption>${inline(img[1])}</figcaption>` : ""}</figure>`);
      continue;
    }
    /* the opening paragraph carries the eye into the piece */
    out.push(`<p${first ? ' class="lede"' : ""}>${inline(b).replace(/\n/g, "<br>")}</p>`);
    first = false;
  }
  return out.join("\n");
}

function table(src, inline) {
  const rows = src.split("\n").map(r => r.trim())
    .filter(r => r && !/^\|[\s|:-]+\|$/.test(r))
    .map(r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  if (!rows.length) return "";
  const [head, ...body] = rows;
  return `<div class="table-card post-table"><div class="table-scroll"><table>
    <thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>
    <tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></div>`;
}

function renderBlock(kind, args, inner, inline) {
  switch (kind) {
    case "stat": {
      const [value, label, note] = args.split("|").map(s => s.trim());
      return `<div class="pb-stat">
        <div class="pb-stat-v">${esc(value || "")}</div>
        <div class="pb-stat-t">
          ${label ? `<div class="pb-stat-l">${inline(label)}</div>` : ""}
          ${note ? `<div class="pb-stat-n">${inline(note)}</div>` : ""}
          ${inner ? `<div class="pb-stat-n">${inline(inner)}</div>` : ""}
        </div></div>`;
    }
    case "stats": {
      const rows = inner.split("\n").map(l => l.split("|").map(s => s.trim()));
      return `<div class="pb-stats">${rows.map(([v, l, n]) => `
        <div class="pb-stats-i">
          <div class="pb-stats-v">${esc(v || "")}</div>
          <div class="pb-stats-l">${inline(l || "")}</div>
          ${n ? `<div class="pb-stats-n">${inline(n)}</div>` : ""}
        </div>`).join("")}</div>`;
    }
    case "pull":
      return `<figure class="pb-pull"><blockquote>${inline(inner)}</blockquote>${
        args ? `<figcaption>${inline(args)}</figcaption>` : ""}</figure>`;
    case "note":
      return `<aside class="pb-note">${inline(inner)}</aside>`;
    case "image": {
      const [src, caption] = args.split("|").map(x => x.trim());
      return `<figure class="pb-fig${inner ? " pb-fig-wide" : ""}">
        <img loading="lazy" alt="${esc(caption || "")}" src="${esc(src || "")}">
        ${caption ? `<figcaption>${inline(caption)}</figcaption>` : ""}</figure>`;
    }
    case "scoreboard":
    case "standings":
      return `<div class="nb-embed" data-embed="${kind}"${
        args ? ` data-args="${esc(args)}"` : ""}></div>`;
    default:
      return `<p>${inline(inner)}</p>`;
  }
}

/* ---------- share card (rasterise separately; see render-cards) ---------- */

function cardHtml(p) {
  const ed = EDITIONS[p.edition] || EDITIONS.announcement;
  const kicker = p.week ? `${ed.label} · ${p.year} Week ${p.week}` : `${ed.label} · ${p.year}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="robots" content="noindex, nofollow, noarchive" />
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
  const featuredImage = p.image
    ? (/^https?:\/\//.test(p.image) ? p.image : `${SITE}/${p.image.replace(/^\//, "")}`)
    : null;
  // Apple Messages can fetch the page but not necessarily render every image
  // format. Use the generated PNG card for non-JPEG/PNG featured images.
  const previewUsesFeatured = featuredImage && /\.(?:jpe?g|png)(?:[?#]|$)/i.test(featuredImage);
  const shareImage = previewUsesFeatured ? featuredImage : `${SITE}/n/cards/${p.slug}.png`;
  const shareDescription = p.image_caption || p.dek;
  const shareAltTag = previewUsesFeatured && p.image_caption
    ? `  <meta property="og:image:alt" content="${esc(p.image_caption)}" />\n`
    : "";
  const featuredHtml = featuredImage
    ? `<figure class="post-featured"><img src="${esc(featuredImage)}" alt="${esc(p.image_caption || p.title)}">${
      p.image_caption ? `<figcaption>${esc(p.image_caption)}</figcaption>` : ""}</figure>`
    : "";
  const when = new Date(`${p.date}T12:00:00`).toLocaleDateString("en-US",
    { month: "long", day: "numeric", year: "numeric" });
  const kicker = p.week ? `${ed.label} · Week ${p.week}` : ed.label;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title>${esc(p.title)} — LWFFL Notebook</title>

  <!-- Discord and iMessage read these without running JS. This is the whole
       reason each post is a real file instead of a client-rendered route. -->
  <meta name="description" content="${esc(p.dek)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="LWFFL Notebook" />
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(shareDescription)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${esc(shareImage)}" />
${shareAltTag}  <meta property="article:published_time" content="${p.date}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:description" content="${esc(shareDescription)}" />
  <meta name="twitter:image" content="${esc(shareImage)}" />
  <meta name="theme-color" content="#0085CA" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/style.css?v=6">
  <script defer src="../assets/nav.js?v=1"></script>
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

  <article class="post" data-edition="${esc(p.edition)}" data-year="${p.year}"${p.week ? ` data-week="${p.week}" data-standings-week="${p.standings_week ?? (p.edition === "recap" ? p.week : Math.max(0, p.week - 1))}"` : ""}>
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
      ${featuredHtml}
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
<script src="../assets/data.js?v=4"></script>
<script src="../assets/notebook.js?v=2"></script>
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

/* ---------- build ---------- */

fs.mkdirSync(path.join(OUT, "cards"), { recursive: true });

const allPosts = fs.readdirSync(SRC).filter(f => f.endsWith(".md")).map(f => {
  const { meta, body } = parse(path.join(SRC, f));
  for (const k of ["slug", "edition", "year", "title", "dek", "date"]) {
    if (meta[k] == null) throw new Error(`${f}: missing "${k}"`);
  }
  if (!EDITIONS[meta.edition]) throw new Error(`${f}: unknown edition "${meta.edition}"`);
  const post = { ...meta, body };
  return post;
});

// Existing posts predate the CMS toggle, so a missing value remains published.
// Only an explicit `published: false` keeps a post out of the deployed site.
const posts = allPosts.filter(p => p.published !== false);
const unpublishedPosts = allPosts.filter(p => p.published === false);

posts.sort((a, b) => b.date.localeCompare(a.date) || (b.week || 0) - (a.week || 0));

// Generated files are committed for previews and may still exist from an
// earlier publish. Remove every variant in the build workspace so unpublishing
// also withdraws the direct URL and its social preview assets.
for (const p of unpublishedPosts) {
  for (const file of [
    path.join(OUT, `${p.slug}.html`),
    path.join(OUT, `${p.slug}.txt`),
    path.join(OUT, "cards", `${p.slug}.html`),
    path.join(OUT, "cards", `${p.slug}.png`)
  ]) fs.rmSync(file, { force: true });
}

for (const p of posts) {
  fs.writeFileSync(path.join(OUT, `${p.slug}.html`), postHtml(p, markdown(p.body)).replace(/[ \t]+$/gm, ""));
  fs.writeFileSync(path.join(OUT, "cards", `${p.slug}.html`), cardHtml(p));
  fs.writeFileSync(path.join(OUT, `${p.slug}.txt`), teaser(p));
}

fs.writeFileSync(path.join(root, "notebook-index.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  posts: posts.map(p => ({
    slug: p.slug, edition: p.edition, year: p.year, week: p.week ?? null,
    title: p.title, dek: p.dek, date: p.date,
    author: p.author || "Commissioner", image: p.image || null,
    pinned: !!p.pinned, sample: !!p.sample
  }))
}) + "\n");

console.log(`${posts.length} published posts -> n/*.html, n/cards/*.html, n/*.txt, notebook-index.json`);
if (unpublishedPosts.length) console.log(`${unpublishedPosts.length} unpublished post(s) excluded`);
for (const p of posts) console.log(`  ${p.date}  ${p.edition.padEnd(12)} ${p.slug}`);
