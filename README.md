# grannydb

A granny square tracker for a 400-square blanket, running entirely out of this repo.

No server, no database, no hosting bill. The data is three CSV files you can read on github.com or
open in a spreadsheet. The app is a static site on GitHub Pages that reads and writes those files
directly through the GitHub API from your browser.

**→ [https://anhtr.github.io/grannydb/](https://anhtr.github.io/grannydb/)**

## What it does

- Browse, search and filter every square — by colour, design, status, or anything you type
- Add and edit squares from a phone, including with no signal; edits queue and push as one commit
- Track yarns (with colour swatches) and designs
- Progress toward 400: counts, pace, and breakdowns by colour and design

## The data

| File | What it holds |
|---|---|
| [`data/squares.csv`](data/squares.csv) | One row per square: date, status, design, colours, notes |
| [`data/yarns.csv`](data/yarns.csv) | Colourways, brands, hex colours, skeins left |
| [`data/designs.csv`](data/designs.csv) | Patterns and where they came from |
| [`data/schema/`](data/schema/) | Field definitions that drive the whole UI |

Edit any of them by hand — on github.com, in a spreadsheet, in a text editor. The app is a
convenience over the data, never a gatekeeper. Adding a column by hand is safe: the app preserves
columns it does not know about.

Adding a *field* to the app is editing a CSV column and a JSON file. No code, no deploy.

## Setup

1. Repo → Settings → Pages → **Source: GitHub Actions**
2. Push to `main`
3. On each device: open the site → Settings → paste a token

The token is a fine-grained PAT scoped to this repo with **Contents: read and write** and nothing
else. It lives in that browser only and is sent nowhere except `api.github.com`. Paste it once per
device.

Without a token the site is read-only, which is what anonymous visitors get.

## Development

```bash
npm install
npm run dev            # http://localhost:5173/grannydb/
npm test
npm run typecheck
npm run build
npm run validate-data  # checks the CSVs against the schemas
```

## How it works

The interesting parts are written up in **[`docs/`](docs/)** — not just what the code does, but why
it is built this way and what each choice costs. It turns out a serverless git-backed app is a small
honest instance of several patterns from much larger systems:

- edits are a **write-ahead log** replayed onto fresh data, which is why two devices merge instead
  of clobbering
- reads are pinned to a commit sha (**snapshot isolation**) and writes are fast-forward-only
  (**optimistic concurrency control**)
- the published JSON is a **materialised view** rebuilt by the pipeline
- CI validates every CSV against the schema, a **data contract test** over a schema-on-read format

Start at [`docs/README.md`](docs/README.md). Decisions and their rejected alternatives are in
[`docs/adr/`](docs/adr/).
