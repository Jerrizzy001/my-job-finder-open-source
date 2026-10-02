import { useEffect, useState, type FormEvent } from 'react'
import { api, type Preferences as Prefs, type WorkMode } from './api.ts'
import { Button, Field, ListEditor, Notice } from './ui.tsx'

const MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On site' },
]

export function Preferences({ onSaved }: { onSaved: () => void }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.preferences().then(setPrefs, (e: Error) => setError(e.message))
  }, [])

  if (!prefs)
    return (
      <div className="page">
        {error ? <Notice tone="error">{error}</Notice> : <div className="skeleton skeleton-title" />}
      </div>
    )

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setSaved(null)
    setPrefs({ ...prefs, [key]: value })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.savePreferences(prefs)
      setPrefs(result.preferences)
      setSaved(`Saved to preferences.json. Re-scored ${result.rescored} postings under the new search.`)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const student =
    prefs.roleTitles.length > 0 &&
    prefs.roleTitles.every((title) => /\b(intern|internship|co-?op|work term|pey|placement|student)\b/i.test(title))

  return (
    <form className="page" onSubmit={submit}>
      <h1>Preferences</h1>
      <p className="lede">
        The same file the CLI reads, <code>preferences.json</code>. Saving re-scores every open posting.
      </p>

      <section className="group">
        <h2>Roles</h2>
        <ListEditor
          label="Titles you want"
          values={prefs.roleTitles}
          onChange={(v) => set('roleTitles', v)}
          placeholder="Software Engineer, then Enter"
          hint={
            student
              ? 'Every title is a student role, so this is a student search: only internships, co-ops and work terms match.'
              : 'Matching reads the kind of work, not just the words: “AI engineer” also finds Applied AI and ML roles.'
          }
        />
        <ListEditor
          label="Titles to skip"
          values={prefs.excludedTitles}
          onChange={(v) => set('excludedTitles', v)}
          placeholder="Staff Software Engineer"
        />
        <ListEditor
          label="Words that drop a posting"
          values={prefs.blockedTerms}
          onChange={(v) => set('blockedTerms', v)}
          placeholder="clearance"
          hint="Whole words in the title."
        />
      </section>

      <section className="group">
        <h2>Where and how</h2>
        <ListEditor
          label="Places you can work on site or hybrid"
          values={prefs.locations}
          onChange={(v) => set('locations', v)}
          placeholder="Toronto"
        />
        <ListEditor
          label="Where you can work remotely from"
          values={prefs.remoteRegions}
          onChange={(v) => set('remoteRegions', v)}
          placeholder="Canada"
          hint="Countries or regions (“North America”, “Anywhere”). Empty means the countries of your places."
        />
        <fieldset className="field">
          <legend>Work modes</legend>
          <div className="checks">
            {MODES.map((mode) => (
              <label key={mode.value} className="check">
                <input
                  type="checkbox"
                  checked={prefs.workModes.includes(mode.value)}
                  onChange={(event) =>
                    set(
                      'workModes',
                      event.target.checked
                        ? [...prefs.workModes, mode.value]
                        : prefs.workModes.filter((m) => m !== mode.value),
                    )
                  }
                />
                {mode.label}
              </label>
            ))}
          </div>
          <p className="hint">None ticked accepts all three.</p>
        </fieldset>
      </section>

      <section className="group">
        <h2>Students</h2>
        <Field label="Expected graduation" hint="A co-op or internship term that ends after this month is skipped.">
          {(id) => (
            <input
              id={id}
              type="month"
              value={prefs.graduation ?? ''}
              onChange={(event) => set('graduation', event.target.value || null)}
            />
          )}
        </Field>
      </section>

      <section className="group">
        <h2>Companies</h2>
        <ListEditor
          label="Blocked companies"
          values={prefs.blockedCompanies}
          onChange={(v) => set('blockedCompanies', v)}
          placeholder="Company name"
        />
        <ListEditor
          label="Titles you turned down"
          values={prefs.rejectedTitles}
          onChange={(v) => set('rejectedTitles', v)}
          hint="Added by “Not for me”. Similar titles score 15 points lower; remove one to undo."
        />
      </section>

      <div className="savebar">
        {error && <Notice tone="error">{error}</Notice>}
        {saved && <Notice tone="ok">{saved}</Notice>}
        <Button variant="primary" type="submit" busy={busy}>
          Save preferences
        </Button>
      </div>
    </form>
  )
}
