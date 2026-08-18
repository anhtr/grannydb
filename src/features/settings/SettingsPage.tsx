import { useState } from 'react'
import { appStore } from '../../core/store'
import { commitUrl, DEFAULT_CONFIG, repoUrl } from '../../core/github'
import type { ConnectionCheck, RepoConfig } from '../../core/github'
import { useAppState } from '../../app/hooks'
import { Button, Card, inputClass } from '../../ui/components'

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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
}) {
  return (
    <div className="px-4 py-3">
      <label className="block text-sm font-medium text-muted">{label}</label>
      <input
        type={type}
        className={`${inputClass} mt-1.5`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function SettingsPage() {
  const state = useAppState()
  const [token, setToken] = useState('')
  const [config, setConfig] = useState<RepoConfig>(state.config)
  const [check, setCheck] = useState<ConnectionCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [startDate, setStartDate] = useState(state.prefs.projectStartDate)

  const configDirty = JSON.stringify(config) !== JSON.stringify(state.config)
  const startDateDirty = startDate !== state.prefs.projectStartDate

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
          <div className="space-y-3 px-4 py-3">
            <p className="text-sm text-muted">
              Paste a fine-grained personal access token scoped to this repo with{' '}
              <strong className="text-ink">Contents: read and write</strong>. It is stored in this
              browser only and sent nowhere except api.github.com. You should only need to do this
              once per device.
            </p>
            <input
              type="password"
              className={inputClass}
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button variant="primary" onClick={() => void onSaveToken()} disabled={busy || !token.trim()}>
              Save token
            </Button>
          </div>
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

      <Section title="Project">
        <Field
          label="Start date"
          type="date"
          value={startDate}
          onChange={setStartDate}
          hint="When you started the blanket. Used to size the pace calculation on the Progress screen so it isn't diluted by weeks before you began."
        />
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Button
            variant="primary"
            disabled={!startDateDirty}
            onClick={() => appStore.setPrefs({ ...state.prefs, projectStartDate: startDate })}
          >
            Save
          </Button>
          {startDate !== '' ? (
            <Button variant="ghost" onClick={() => setStartDate('')}>
              Clear
            </Button>
          ) : null}
        </div>
      </Section>

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
            Clears the cached copy of the repo on this device. Unsynced edits are kept.
          </p>
          <Button onClick={() => void appStore.reload()}>Reload from GitHub</Button>
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
    default:
      return '—'
  }
}
