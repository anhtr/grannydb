import { useId, useState } from 'react'
import { appStore } from '../../core/store'
import { commitUrl, DEFAULT_CONFIG, repoUrl } from '../../core/github'
import type { ConnectionCheck, RepoConfig } from '../../core/github'
import { deviceTimeZone } from '../../core/date'
import { PROJECT_KEYS } from '../../core/project'
import type { ProjectInfo } from '../../core/project'
import { useAppState, useCanEdit, useProject } from '../../app/hooks'
import { Button, Card, Link, inputClass } from '../../ui/components'
import { relativeTime } from '../../ui/time'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-medium text-muted">{title}</h2>
      <Card className="divide-y divide-line overflow-hidden">{children}</Card>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="px-4 py-3">
      <label htmlFor={id} className="block text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={`${inputClass} mt-1.5`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/** Blank, or a whole number of squares. Anything else is not saveable. */
function parseTarget(input: string): number | null | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Every IANA zone this browser knows, with the saved one kept in the list even if it doesn't — so a
 * zone saved on another device never silently reads as "device time zone" here. Older browsers
 * without `Intl.supportedValuesOf` get just the device's zone and the saved one.
 */
function timeZoneOptions(saved: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [deviceTimeZone()]
  return saved && !known.includes(saved) ? [saved, ...known] : known
}

function TimeZoneField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const id = useId()
  return (
    <div className="px-4 py-3">
      <label htmlFor={id} className="block text-sm font-medium text-muted">
        Time zone
      </label>
      <select id={id} className={`${inputClass} mt-1.5`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Device's own ({deviceTimeZone().replace(/_/g, ' ')})</option>
        {timeZoneOptions(value).map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-muted">
        Which time zone decides what day it is: the date a new square gets, and where today begins and ends on the
        Progress screen. Set it so every device agrees, even one still on another zone while you travel.
      </p>
    </div>
  )
}

/**
 * Start date, target and time zone, edited in place but stored in `project.json`: Save queues a `set`
 * operation like any record edit, so the change shows up everywhere straight away and reaches the
 * repo — and every other device — on the next sync. Remounted (via `key`) whenever the stored values
 * change, so the inputs pick up a fresh load or a synced edit instead of holding stale text.
 */
function ProjectSection({ project }: { project: ProjectInfo }) {
  const canEdit = useCanEdit()
  const [startDate, setStartDate] = useState(project.startDate)
  const [targetInput, setTargetInput] = useState(project.targetSquares > 0 ? String(project.targetSquares) : '')
  const [timeZone, setTimeZone] = useState(project.timeZone)
  const target = parseTarget(targetInput)
  const dirty =
    startDate !== project.startDate || (target ?? 0) !== project.targetSquares || timeZone !== project.timeZone

  return (
    <Section title="Project">
      <Field
        label="Start date"
        type="date"
        value={startDate}
        onChange={setStartDate}
        disabled={!canEdit}
        hint="When you started the blanket. The Progress screen's pace and charts count from here, so weeks before you began don't dilute them."
      />
      <Field
        label="Target squares"
        type="number"
        value={targetInput}
        onChange={setTargetInput}
        disabled={!canEdit}
        hint={`How many squares finish the blanket, shown as "X / target" on Progress. Leave blank for no target.`}
      />
      <TimeZoneField value={timeZone} onChange={setTimeZone} disabled={!canEdit} />
      <div className="space-y-2 px-4 py-3">
        {canEdit ? (
          <Button
            variant="primary"
            disabled={!dirty || target === undefined}
            onClick={() =>
              void appStore.saveProject({
                [PROJECT_KEYS.startDate]: startDate === '' ? null : startDate,
                [PROJECT_KEYS.targetSquares]: target ?? null,
                [PROJECT_KEYS.timeZone]: timeZone === '' ? null : timeZone,
              })
            }
          >
            Save
          </Button>
        ) : null}
        <p className="text-xs text-muted">
          {canEdit ? (
            <>
              Stored in <span className="font-mono">project.json</span> with the rest of the data, so every device
              sees the same values. Saving queues a change —{' '}
              <Link to="/sync" className="underline underline-offset-2">
                sync
              </Link>{' '}
              to push it.
            </>
          ) : (
            <>
              Stored in <span className="font-mono">project.json</span> with the rest of the data. Add a GitHub token
              above to edit.
            </>
          )}
        </p>
      </div>
    </Section>
  )
}

export function SettingsPage() {
  const state = useAppState()
  const project = useProject()
  const [token, setToken] = useState('')
  const [config, setConfig] = useState<RepoConfig>(state.config)
  const [check, setCheck] = useState<ConnectionCheck | null>(null)
  const [busy, setBusy] = useState(false)

  const configDirty = JSON.stringify(config) !== JSON.stringify(state.config)

  const onSaveToken = async () => {
    if (token.trim() === '') return
    setBusy(true)
    try {
      await appStore.setToken(token)
      setToken('')
      setCheck(await appStore.testConnection())
    } finally {
      setBusy(false)
    }
  }

  const onTest = async () => {
    setBusy(true)
    try {
      setCheck(await appStore.testConnection())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 px-4 pb-24">
      <Section title="GitHub access">
        {state.token ? (
          <div className="space-y-3 px-4 py-3">
            <p className="text-sm">
              A token is saved on this device. Edits are enabled.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onTest()} disabled={busy}>
                Test connection
              </Button>
              <Button variant="danger" onClick={() => void appStore.signOut()}>
                Forget token
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              void onSaveToken()
            }}
          >
            <p className="text-sm text-muted">
              Paste a fine-grained personal access token scoped to this repo with{' '}
              <strong className="text-ink">Contents: read and write</strong>. It is stored in this
              browser only and sent nowhere except api.github.com. You should only need to do this
              once per device.
            </p>
            <input
              type="password"
              aria-label="GitHub token"
              enterKeyHint="done"
              className={inputClass}
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
              Save token
            </Button>
          </form>
        )}

        {check ? (
          <p
            className={`px-4 py-3 text-sm ${
              check.ok && check.canWrite !== false
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {check.message}
            {check.login ? ` (as ${check.login})` : ''}
          </p>
        ) : null}
      </Section>

      <ProjectSection key={`${project.startDate}|${project.targetSquares}|${project.timeZone}`} project={project} />

      <Section title="Data location">
        <Field label="Owner" value={config.owner} onChange={(v) => setConfig({ ...config, owner: v })} />
        <Field label="Repo" value={config.repo} onChange={(v) => setConfig({ ...config, repo: v })} />
        <Field label="Branch" value={config.branch} onChange={(v) => setConfig({ ...config, branch: v })} />
        <Field
          label="Data directory"
          value={config.dataDir}
          onChange={(v) => setConfig({ ...config, dataDir: v })}
          hint="Where the CSVs and schema/ live inside the repo. Change this to point at a separate data repo."
        />
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Button
            variant="primary"
            disabled={!configDirty}
            onClick={() => void appStore.setConfig(config)}
          >
            Save and reload
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfig(DEFAULT_CONFIG)
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </Section>

      <Section title="Status">
        <dl className="divide-y divide-line text-sm">
          <Row label="Read from">{describeSource(state.snapshot?.source)}</Row>
          <Row label="Data as of">
            {state.snapshot ? relativeTime(state.snapshot.fetchedAt) : '—'}
          </Row>
          <Row label="At commit">
            {state.snapshot?.commit ? (
              <a
                href={commitUrl(state.config, state.snapshot.commit)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono underline underline-offset-2"
              >
                {state.snapshot.commit.slice(0, 7)}
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Unsynced edits">{String(state.changes.length)}</Row>
          <Row label="Last sync">
            {state.lastSync ? (
              <a
                href={commitUrl(state.config, state.lastSync.sha)}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {new Date(state.lastSync.at).toLocaleString()}
              </a>
            ) : (
              'never'
            )}
          </Row>
          <Row label="Repository">
            <a
              href={repoUrl(state.config)}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {state.config.owner}/{state.config.repo}
            </a>
          </Row>
        </dl>
      </Section>

      <Section title="Local data">
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-muted">
            Forgets the copy of the repo saved for offline use on this device and reads it again.
            Unsynced edits are kept.
          </p>
          <Button onClick={() => void appStore.refreshFromGitHub()}>Reload from GitHub</Button>
        </div>
      </Section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

function describeSource(source: string | undefined): string {
  switch (source) {
    case 'api':
      return 'GitHub API (signed in)'
    case 'bundle':
      return 'published snapshot (read-only)'
    case 'raw':
      return 'raw.githubusercontent (read-only)'
    case 'cache':
      return 'saved copy on this device (offline)'
    default:
      return '—'
  }
}
