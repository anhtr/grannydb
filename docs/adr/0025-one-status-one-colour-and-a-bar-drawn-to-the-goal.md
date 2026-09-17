# ADR 0025 — One status, one colour; and the status bar is drawn to the goal

**Status:** accepted · 2026-09-17

## Context

The Progress screen's "By status" card used to draw one accent-coloured bar per status, each scaled
against the largest status rather than against anything meaningful. That answers "how many are
blocked" but not "how much of the blanket is that" — the question a status breakdown is actually for —
and the only way to get the second answer was to sum four bars by eye.

Replacing it with a single part-to-whole bar forces two decisions the old card never had to make: what
colour each segment is, now that four of them touch, and what the bar's full width *means*.

## Options — the colour

**A new scale for the chart.** Either the categorical hues already in `styles.css`
(`--color-chart-1..5`, added for the "By source" donut) or a purpose-built ordinal ramp — one hue in
four lightness steps, so the workflow order is visible in the colour itself. The ramp is the
textbook answer for ordered categories, and it was built and validated before being thrown away.

What killed it is that a status is not a new thing that needs a colour. It has had one for as long as
the app has existed: the badge on every Squares row. A second scale for the same value means two
things to keep in step, two things to learn, and a square that is cyan in a list and dark brown on a
chart. The textbook answer was solving a problem this app doesn't have.

**Repaint the badges from the new scale instead**, so there is still only one scale. Tried, and
rejected by the owner: it makes the chart the source of truth for a colour the list has owned all
along, and it costs the familiar green/cyan reading of a list that gets glanced at far more often than
the Progress screen does.

**Use the badge colours for the chart.** One mapping, in one module, keyed by the status value.

## Options — the length

**The bar is the squares recorded.** Simple, and it makes the card purely about composition — but
that bar is always exactly full, so it never shows progress, and the composition it shows is of a pile
whose size you have to read off another card.

**The bar is the goal**, with everything not yet made left grey at the right-hand end. The bar then
fills up over the life of the project, and the same picture carries composition *and* progress.

## Decision

Both of the second options. [`ui/status.ts`](../../src/ui/status.ts) holds the one status → colour
mapping: `statusTone` for the badge (a pale tint with dark text, right for a chip) and `statusMark`
for a chart mark (the solid fill of the same family, `--color-status-*`). A status the schema no
longer lists gets a neutral badge and a muted segment rather than another status's colour.

The bar is drawn to `effectiveGoal`, with `goal - squares recorded` as a grey `--color-line` segment
at the end, labelled "to go". Past the goal that segment is zero-width and the bar is all statuses
again.

## Consequences

- A status is one colour everywhere it is drawn, and adding a status means adding one row to one map
  next to the schema change — not painting it twice.
- The badge tints and the mark fills are different weights of the same families, so they are *not*
  literally the same hex. That is deliberate — a badge is a chip with text inside it and a segment is
  a mark — but it does mean the two can drift if someone edits one and not the other. They live in the
  same file so that stays a small risk.
- **"In progress" is a yellow on the chart, not the badge's amber.** In a stacked bar it lands
  directly beside "planned", and the two ambers were within ΔE 7 under normal vision — a pair a
  full-colour reader cannot separate at the one place they touch. The badges keep their amber, where
  they never sit side by side. This is the cost of inheriting a palette that was chosen for chips: it
  was never checked as a set of adjacent marks. Checked now, in bar order, with the dataviz skill's
  validator against this app's card surface in both modes.
- The light-mode yellow sits at 2.2:1 on white, below the 3:1 floor for a mark. Legal only because the
  segment labels and the expanded list mean no value is ever colour-only — the same relief the "By
  source" donut already leans on, and the reason the card keeps its labels.
- Scaling to the goal makes the card read against `Prefs.goal` ([ADR 0017](0017-device-local-goal-override.md)),
  so someone with a device-local goal override sees their own bar. With no goal set at all, the bar
  falls back to the squares recorded and is simply always full.
- Most segments are now a small slice of a mostly-empty bar, so a label rarely fits beside its own
  number. The card stacks the name over the count instead, and measures the bar to decide — the one
  piece of layout on this page that JavaScript has to do, because an estimate is wrong in both
  directions: assume a narrow screen and a 390px phone loses labels it had room for; assume a wide one
  and a 320px phone clips them.
