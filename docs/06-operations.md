# 6. Operations

## The pipeline

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), on every push to `main`:

```
checkout → npm ci → typecheck → test → validate data → build → upload → deploy Pages
```

The build emits `dist/data/bundle.json` alongside the app, generated from the CSVs by
[`scripts/build-data.ts`](../scripts/build-data.ts) via a small Vite plugin.

### Data commits deploy too

The original plan had `paths-ignore: data/**` so that syncing squares would not trigger a rebuild.
That was dropped, for two reasons:

1. The published JSON snapshot is generated at build time, so a data change *has* to rebuild for
   anonymous visitors to see it.
2. The build validates every CSV. Skipping it on data commits would skip validation on exactly the
   commits most likely to break it.

The cost is a ~1 minute deploy after each sync, which nobody waits on: signed-in users read live
CSVs through the API and see their edits immediately. The bundle only serves anonymous visitors.
Actions minutes are free on public repos.

## The data contract

CSV is schema-on-read: the file cannot reject a bad row. A hand-edit can introduce a status of
`dune`, a duplicate id, or a `main_yarn` pointing at a yarn that does not exist, and git will
cheerfully accept all three.

So enforcement lives at the pipeline boundary. `validateDataset` checks:

- every row has an id, and ids are unique within a table
- `required` fields are non-empty
- `enum` values are in the schema's `options`
- `date` values are real dates in `YYYY-MM-DD`
- `color` values are hex
- `url` values parse
- **`ref` and `reflist` values point at rows that exist** — referential integrity, which CSV has no
  concept of

A failure fails the build, names the table, row id and field, and nothing deploys.

The same function runs in the browser before a sync, where it is *advisory* — issues are listed on
the sync screen but do not block the commit. Losing your work because a reference looks odd would be
the wrong trade in an app for capturing squares quickly. CI is the gate; the app is the warning.

Running one function in both places is the point. If validation were reimplemented in the pipeline,
the two would drift and the app would start believing things CI rejects.

`npm run validate-data` runs the check alone, in seconds, without a build.

## Local development

```bash
npm install
npm run dev            # http://localhost:5173/grannydb/
npm test               # vitest
npm run typecheck
npm run build          # validates data, then builds to dist/
npm run validate-data  # just the data contract check
```

The dev server serves `/data/bundle.json` from a middleware that re-reads the CSVs on every request,
so editing `data/squares.csv` and refreshing shows the change. If the data is invalid it returns a
500 rather than serving something the build would reject.

Without a token the dev server shows the read-only view. Paste a token in Settings to edit — note
that this writes to the **real repo**, so use a scratch branch (Settings → Branch) if you are
experimenting.

## First-time setup

1. **Repo → Settings → Pages → Source: GitHub Actions.** Without this the workflow succeeds and
   nothing is published.
2. Push to `main`. The site appears at `https://anhtr.github.io/grannydb/`.
3. On each device: open the site → Settings → paste a token.

### Creating the token

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new:

| Setting | Value |
|---|---|
| Repository access | Only select repositories → `grannydb` |
| Permissions | **Contents: Read and write** (Metadata: Read is added automatically) |
| Expiration | Your call; 1 year is a reasonable default |

Nothing else. No `workflow`, no `admin`, no org scope, no other repos.

Keep it in your password manager. "Test connection" in Settings reports the permissions the token
*actually* has, which is how you find out about a missing write scope now rather than at the first
sync.

## Security posture

The honest version.

**What is exposed.** A fine-grained PAT sits in `localStorage` on `anhtr.github.io`. Every project
page under that user shares that origin, so any script running on any of them can read it. This is
a property of GitHub Pages, not something the app can fix.

**Why it is acceptable.** The token is scoped to one repo with Contents-only permission. The worst
case for an attacker is editing a list of granny squares. It cannot touch other repos, cannot change
settings, cannot push workflows.

**What the app does about it anyway:**

- **Everything is bundled.** No CDN scripts, no remote fonts, no analytics. A compromised third
  party is the realistic way a static site gets XSS, so there are no third parties.
- **A CSP in [`index.html`](../index.html)** restricting `connect-src` to `api.github.com` and
  `raw.githubusercontent.com`, `script-src` to `'self'`, with `base-uri 'none'` and
  `frame-ancestors 'none'`. If script does run, exfiltration is constrained.
- **The token goes nowhere else.** It is attached to `api.github.com` requests and nothing more.

**If you want to harden further:** put this app on a custom domain, which gives it an origin of its
own and removes the shared-origin problem entirely.

**If a token leaks:** revoke it on GitHub. Nothing else is needed — the app holds no other state,
and `git revert` undoes any damage.

## Going private later

The stated concern is the *code* being private rather than the data. Three routes, in increasing
order of hassle:

1. **Private repo + GitHub Pro** ($4/mo). Pages serves from a private repo. Simplest. Note the
   published site — and the data baked into `bundle.json` — stays public regardless.
2. **Private source repo → public Pages repo.** An Action builds and pushes `dist/` to a public
   repo that serves Pages. Free, code hidden, data public.
3. **Public app repo + private data repo.** The app stays public; the CSVs move. Anonymous visitors
   see nothing; you see everything with a token.

Route 3 costs almost nothing to prepare for and it already works: owner, repo, branch and data
directory are configuration, not constants
([ADR 0008](adr/0008-single-repo-with-configurable-data-location.md)). Point Settings at the other
repo and the app follows.

What is *not* possible, on any route, is a private repo whose data anonymous visitors can still
browse. A static site has no secrets. See
[ADR 0006](adr/0006-public-data-and-anonymous-reads.md).

## Backups

The repo is the backup: full history, every version of every square, restorable with `git revert`.
Clone it anywhere. Worst case the app breaks entirely and the data is still three CSV files you can
open in Excel — which was the point of choosing CSV.
