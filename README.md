A fully documented, data-driven archive of the **Legion of Whom Fantasy Football League (LWFFL)**.

## Weekly data sync (scores, box scores, transactions, trades)

The current season updates itself. `.github/workflows/espn-sync.yml` runs
`scripts/sync-espn.mjs` daily at 7am ET and again Tuesdays at 2pm ET, from August through January.
It pulls the season from ESPN's league API, rebuilds this season's rows in
`league-scores.json`, `boxscores-YYYY.json`, `transactions-YYYY.json`,
`trades-history.json` and their index files, reruns the trade-value and
manager-highlight builders, commits, and redeploys. If ESPN has nothing new,
it commits nothing.

- **Credentials.** The league is private, so the workflow needs two repository
  secrets, `ESPN_S2` and `ESPN_SWID` (the `espn_s2` and `SWID` cookies from a
  browser signed in to ESPN Fantasy). They last about a year. When they expire,
  the run fails with a message saying so, and GitHub emails the repo owner.
- **Every completed week is rebuilt on every run,** so ESPN stat corrections flow
  through. Earlier seasons are never refetched or changed.
- **Nothing is written unless the checks pass.** Starters must add up to each
  team total, box scores must match `league-scores.json` 1:1, and every manager
  must be a known first-name label.
  A new owner or an ownership change stops the sync until someone picks a label.
- **Never published:** trade proposals, declines and upholds; anything still
  pending (ESPN shows only the signed-in manager's own pending claims, so publishing
  them would expose that manager's live claims and bids); draft picks. See the
  header of `sync-espn.mjs` for the reasons.
- **Trades.** ESPN often drops a completed trade's player list, so the sync also
  recovers it from rosters and keeps it in `trades-history.json` once captured.
  Running daily is what makes that reliable.
- **Manual run:** Actions → Sync ESPN data → Run workflow. Locally:
  `ESPN_S2=… ESPN_SWID=… node scripts/sync-espn.mjs --dry-run`.

`scripts/check-data.mjs` runs on every deploy and enforces the same privacy and
1:1 rules no matter what wrote the files. Season-end files (`final-standings.json`,
`playoff-seeds.json`, `league-config.json`) are still updated by hand.

## Positional-edge analytics

Stat Lab's **Positional Edge** tab reads the canonical `boxscores-YYYY.json` files and compares every normalized lineup position with that position's league-wide average in the same week. The default view is all-time across every available regular-season and playoff lineup, with the manager included in the weekly average so each position is zero-sum across the league. Regular season and playoffs can also be selected separately.

Lineups before 2025 assign the highest-scoring required RBs, WRs, and TE first; the remaining third RB/WR or second TE is FLEX. Beginning in 2025, required RB and WR slots are assigned first, then FLEX, then WR/TE. The FLEX choice preserves a valid WR/TE player when necessary, so a lineup with three RBs and three WRs assigns the extra RB to FLEX and the extra WR to WR/TE. Empty and zero-point starters remain in the calculation.

Run the focused checks with `node scripts/test-lineup-edge.cjs`.

## Notebook standings

Posts with a `::: standings` block show divisions and projected playoff spots
through the `standings_week` in their frontmatter. Set it to the last completed
week when publishing; a Week 2 preview, for example, uses `standings_week: 1`.
This keeps an older post from changing when later games are added. The Pages CMS
has a **Standings through week** field for this value.

Division rosters live in `data/notebook-divisions.json`. Add a season there before
publishing its first Notebook standings block. Use the manager labels from the
score data (for example, `Tom` is displayed as Thomas). The shaded rows show
provisional playoff positions, following the Constitution's three division
leaders, one record wildcard, and two points wildcards.

## Publishing Notebook posts

The Pages CMS editor includes a **Published** toggle for every Notebook post.
It is on by default. Turn it off and save to keep a draft out of the Notebook
feed, homepage, generated post pages, teasers, and social cards. Turn it back
on and save to publish the post again. Existing posts without a `published`
frontmatter value remain published.

Notebook Markdown source files are removed from the GitHub Pages deployment
artifact so an unpublished draft cannot be read through its raw source URL.

## Notebook images in Pages CMS

Upload photos in **Media** (`n/img`), then open a Notebook post. To place a photo
exactly where it belongs in the story, put this on its own line in **Story
(Markdown)**, replacing the path and caption:

```markdown
![Caption readers will see beneath the image](/n/img/photo.jpg)
```

You can repeat that anywhere in the story. The existing `::: image URL | caption`
block also works; use its optional inner text to make an image wider on desktop.
Keep custom `:::` blocks in the Markdown editor rather than converting them to
rich text.

**Featured image** appears below the date, author and Copy link. Its **Featured
image caption** appears under it and replaces the usual summary in apps that
display a link-preview description. JPEG and PNG featured images are also used
for link previews; other formats use the generated Notebook card for broader
preview compatibility. Add extra story images with the Markdown line above.
Some apps cache link previews, so an old share may take time to refresh.
Use only photos you own or have a license to publish; a photo being visible on
another website does not grant permission to re-upload it here.
