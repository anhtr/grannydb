# ADR 0029 — Weeks start on Monday, and averages are taken over complete periods only

**Status:** accepted · 2026-10-18

## Context

The Progress screen's "Over time" card is the first thing in the app to group squares by *calendar*
week and day rather than by a trailing window (the Pace tile's "last 4 weeks" is a window ending
now, with no notion of where a week begins). That forces two questions the app had not had to
answer.

**Where does a week begin?** JavaScript's `Date#getDay` numbers Sunday as 0, the US convention, and
any code that groups with it inherits Sunday-start weeks without anyone having decided that. The
owner's rule is that every week in the project — every chart and every calculation — runs Monday
to Sunday (the ISO 8601 week, and the one a UK calendar shows).

**What do you do with the period you are in the middle of?** Today and the current week are still
being added to. On a Monday morning the current week holds nothing yet.

## Options — the week

**`getDay` and a shift at each call site.** Cheap, and exactly how a Sunday-start week sneaks back
in the next time someone groups by week and forgets the shift.

**One definition in `core/date.ts`.** `weekdayIndex` (Monday = 0 … Sunday = 6) and `weekStart`, and
nothing else in the app reads a weekday from `Date`. A rule that holds "everywhere" has to live in
one place to stay true.

## Options — the partial period

**Count it like any other.** The moving average then dips every Monday and recovers by Sunday — a
saw-tooth that is purely an artefact of when you looked, and the weekday averages would count today
as a day on which, so far, nothing was made.

**Pro-rate it** (squares so far ÷ fraction of the week elapsed). Honest about the rate, but the bar
would then show a number nobody made, and a single square on a Monday would project to seven.

**Draw it, but leave it out of every average.** The current week and today are drawn faded so you
can watch them fill, their readout says "so far", and their moving-average point is simply absent.
The weekday averages are taken over finished days only, with today's count shown as the "this week"
mark rather than folded into the average.

## Decision

One week definition in [`core/date.ts`](../../src/core/date.ts), and the third option for partial
periods, in [`core/timeline.ts`](../../src/core/timeline.ts) (`squaresOverTime`). Calendar arithmetic
runs on whole day numbers (`dayNumber`, read through `Date.UTC`) rather than local `Date` objects, so
a daylight-saving change can't move a square into the neighbouring day.

Moving averages use a trailing window — 4 weeks, 7 days — that shrinks at the start of the series
instead of treating days before the project as zeros, for the same reason the Pace tile's window
shrinks: a project in its second week shouldn't read as half its real rate.

## Consequences

- The moving-average line always stops one period short of the columns. That is the intended
  reading — "not known yet" — but it can look like a missing point at first glance.
- The *first* week is usually partial too (a project that starts on a Friday has a three-day first
  week), and it is treated as complete. Leaving it out would throw away real squares, and its effect
  on a 4-week average washes out within a month.
- A square dated in the future is left out of every chart until its day comes.
- The native date picker on the square form still shows whatever first weekday the device's locale
  uses; that is the browser's widget, not a calculation, and the app has no say over it.
