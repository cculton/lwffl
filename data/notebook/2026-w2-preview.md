---
slug: 2026-w2-preview
edition: preview
year: 2026
week: 2
title: Everybody gets a chance to explain themselves
dek: A sample preview showing the layout — every block the Notebook can use, with placeholder copy where a real week's matchups would go.
date: 2026-09-18
author: Cobey
sample: true
---
This is a **sample post**. The copy is placeholder; every block below is real and works exactly like this in a live preview.

A Thursday preview opens with the week's framing — who has something to prove, which game decides an early division, what Week 1 did and didn't tell us. Two or three paragraphs, then the numbers take over.

## The number that frames the week

::: stat 42.00 | Cobey's Week 1 margin | The largest of the opening week, and the reason he is favoured here.
:::

A single figure, set large, for the one thing you want people to remember. Drop it wherever it lands hardest — usually right after the paragraph that earns it.

## The slate

::: stats
6 | Games | Week 2
1500 | Median ELO | Across the league
4 | Rematches | Of a 2025 playoff game
:::

A row of smaller figures when several things matter at once and none of them deserves the full treatment.

| Matchup | Line | Series |
|---|---|---|
| Stuart vs Cobey | Stuart −3.5 | 7–5 Cobey |
| Thomas vs Chad | Thomas −1.0 | 9–9 |
| Adam vs Samuel | Samuel −8.5 | 4–8 Samuel |

Ordinary markdown tables work, which is usually the cleanest way to lay out a slate.

::: pull
The rematch nobody has stopped talking about, eleven months later.
:::

A pull quote for the line worth stealing — set in the display face so it breaks the column visually rather than just sitting there in italics.

## Images

![A photo runs full width with its caption underneath. Drop a file in n/img/ and reference it the ordinary markdown way.](../n/cards/2026-w1-recap.png)

Use `::: image path | caption` instead when the caption should differ from the alt text. A post can also set `image:` in its frontmatter to override the share card, so a link with a real photo unfurls with that photo rather than the generated text card.

## Where last week left things

::: standings
:::

The standings and the scoreboard are read from the league's own box scores when the page loads, not typed in — so they stay correct however long it has been.

::: note
Replace this file with the week's real preview and the sample badge disappears on its own.
:::
