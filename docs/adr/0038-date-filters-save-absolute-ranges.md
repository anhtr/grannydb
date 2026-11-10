# ADR 0038 - Date filters are from-to ranges, saved as absolute dates

**Status:** accepted · 2026-11-10

## Context

A square carries four dates (planned, started, done, blocked). All four could be sorted on and none
could be filtered, so "what did I finish this month" or "what have I blocked since the 1st" meant
sorting by the date and scrolling to the right stretch. The filter machinery already had two shapes:
pills of a field's distinct values, and the min-max slider every `number` gets
([ADR 0034](0034-numeric-filters-are-min-max-sliders.md)). Neither fits a date as it stands.

Two things had to be decided: what the control is, and what a saved selection means tomorrow.
`ListPrefs.filters` is device-local and outlives the day it was set on, the same wrinkle ADR 0034
met with a slider's top end.

## Options - the control

**Pills of the distinct dates**, which is what marking a date `"filter": true` did before this. One
pill per day a square was finished: hundreds of options within a few months, and it can only ever
answer "on exactly this day". Rejected.

**Pills per month** ("2026-10", "2026-11"). Compact, and it answers the commonest question, but not
"this week", "the last 30 days", or any span that crosses a month end. It is also a second, coarser
meaning for the same field. Rejected.

**A slider over the date span**, reusing `RangeFilter`. Consistent with numbers, but a slider over
500 days gives each day a fraction of a pixel on a phone; picking a particular date would be luck.
Rejected.

**Two native `<input type="date">`, from and to, either optional.** The browser supplies the picker,
keyboard entry and the locale's date order, as it does for the date fields on the edit form. Exact,
and any span is expressible. The cost is taps: a range is two pickers, which is why shortcuts exist.

## Options - what a shortcut saves

**The phrase** - save a token such as `this-month` and resolve it against today on every render.
"This month" would then stay true forever, which is what the words promise. But it puts two kinds of
value in one slot (a token or a pair of dates), every reader of the slot has to resolve tokens
before it can match or describe anything, and the result depends on the clock: the same saved
filter shows different rows on different days with nothing on screen having changed. It also needs
a today, and "today" here is the project's, not the device's.

**The dates** - a shortcut is only a faster way to fill in the two boxes; what is saved is
`[from, to]`. One shape, one matching rule, and the filter means the same thing every time the list
opens. The cost is that "This month" tapped on 30 November still says November on 1 December.

## Decision

`type: "date"` with `"filter": true` renders as a `DateFilterDescriptor` (`ui/RecordList.tsx`), with
no per-field setting, the same rule ADR 0034 set for numbers: the type decides. The control is
`DateFilter`, two native date inputs plus shortcut pills for this week (Monday to Sunday), this
month and the last 30 days.

A selection is saved in the `string[]` slot every filter uses, as `[from, to]` in `YYYY-MM-DD`, both
ends inclusive, `''` meaning unbounded, and nothing at all when neither is set. Shortcuts save the
absolute dates they stand for. Matching, the saved shape and the shortcuts are pure functions in
`ui/dateFilter.ts`, compared as strings because ISO dates sort the same either way.

A blank date matches no range. Ends typed the wrong way round are read as the range they span, and
are ordered when *read*, not when saved: a date box reports half-typed years on the way to the one
meant, and swapping the two boxes on those would move the text out from under the person typing.

Each date filter is collapsed to its label and a summary until opened, and starts open when it is
set.

## Consequences

- "Done this month" is two taps: Filter, then This month under Done.
- A shortcut left on goes stale at the end of its period. The summary shows the actual dates, not the
  shortcut's name, so what is being shown is never misdescribed, and tapping the shortcut again moves
  it forward. If this proves annoying in practice, the phrase option above is the way back, and the
  cost it carries is known.
- The saved value is a pair of plain dates, so anything that later describes or edits filters (a
  chip per active filter, say) needs no clock to do it.
- All four of a square's dates are now filterable, which adds four rows to the Squares filter panel.
  Collapsing them keeps that to four lines; a table with a dozen date fields would want grouping.
- Shortcuts use the project's today (`useToday`), so two devices in different time zones agree which
  week it is, consistent with how pace and the Progress screen count days.
- A date filter cannot say "blank" (not yet done). The status filter answers that for a square's
  dates; a general "is blank" option for every filter type is a separate change.
