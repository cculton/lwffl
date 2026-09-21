A fully documented, data-driven archive of the **Legion of Whom Fantasy Football League (LWFFL)**.

## Position-edge analytics

Stat Lab's **Position Edge** tab reads the canonical `boxscores-YYYY.json` files and compares every normalized lineup position with that position's league-wide average in the same week. The default view is all-time regular season, with the manager included in the weekly average so each position is zero-sum across the league. Playoffs can be selected separately.

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
