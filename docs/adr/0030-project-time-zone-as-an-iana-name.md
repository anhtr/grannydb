# ADR 0030 — The project's time zone is an IANA name in `project.json`

**Status:** accepted · 2026-10-18

## Context

Everything date-shaped in the app hinges on one question: what day is it? It decides the date a new
square is given, which squares fall in the Pace tile's last 28 days, and where the Over time card's
"today" and "this week" begin. Until now the answer was "whatever the device's clock says", which is
fine until two devices disagree — a phone still on home time while travelling, or a laptop set to UTC
— and then the same square lands on different days depending on where you look from.

The owner asked for the time zone to be a project setting, editable from Settings, defaulting to the
device's zone when unset.

## Options

**A fixed UTC offset** (`-05:00`). Simple to store and to apply, and wrong twice a year: Chicago is
−5 in summer and −6 in winter, so an offset saved in October would start each day an hour off from
November to March, and a square finished late in the evening could land on tomorrow.

**A device preference**, like list filters. Each device would still disagree with the others, which
is the problem being solved. Project-level facts already moved out of device storage for the same
reason ([ADR 0028](0028-project-settings-as-a-synced-json-document.md)).

**An IANA zone name in `project.json`** (`America/Chicago`). The platform's `Intl.DateTimeFormat`
already knows every zone's DST rules, so "today in Chicago" is one call with no tables of our own, and
the setting syncs and is validated like the start date and target.

## Decision

An optional `time_zone` key in `project.json`, holding an IANA name. `today(timeZone)` in
[`core/date.ts`](../../src/core/date.ts) formats the current instant in that zone; an unset or
unrecognised value falls back to the device's zone, so a project that never sets it behaves exactly
as before. `validate-data` rejects a name the runtime doesn't know.

It applies to every "today" in the app, not just the Progress screen: a square's default date and the
Pace window disagreeing about what day it is would be a worse bug than the one being fixed.

## Consequences

- Only "today" is zoned. Dates in the CSVs stay plain calendar days with no zone attached, and all
  arithmetic on them stays zone-free ([ADR 0029](0029-monday-weeks-and-averages-over-complete-periods.md));
  a zone change never rewrites a stored date.
- The Settings list is whatever `Intl.supportedValuesOf('timeZone')` gives, around 400 names, as a
  native `<select>` — long, but on a phone the native picker scrolls fine, and a typed name would need
  its own validation and autocomplete for no real gain.
- A zone this browser doesn't know (saved from a newer one) still appears in its picker rather than
  silently reading as "device's own", but `today()` falls back to the device's zone on that browser.
