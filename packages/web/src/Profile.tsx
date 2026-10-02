import { useEffect, useState, type FormEvent } from 'react'
import { api, type Experience, type Profile as ProfileData, type VaultAnswer } from './api.ts'
import { Button, Field, Icon, ListEditor, Notice } from './ui.tsx'

function slugKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function ExperienceEditor({ value, onChange }: { value: Experience[]; onChange: (value: Experience[]) => void }) {
  const update = (index: number, patch: Partial<Experience>) =>
    onChange(value.map((job, i) => (i === index ? { ...job, ...patch } : job)))
  return (
    <div className="stack">
      {value.map((job, index) => (
        <fieldset className="entry" key={index}>
          <legend>
            {job.title || 'Role'}
            {job.employer ? ` at ${job.employer}` : ''}
          </legend>
          <div className="grid-2">
            <Field label="Title">
              {(id) => <input id={id} value={job.title} onChange={(e) => update(index, { title: e.target.value })} />}
            </Field>
            <Field label="Employer">
              {(id) => (
                <input id={id} value={job.employer} onChange={(e) => update(index, { employer: e.target.value })} />
              )}
            </Field>
            <Field label="Start" hint="As on your resume, e.g. 2024-06">
              {(id) => <input id={id} value={job.start} onChange={(e) => update(index, { start: e.target.value })} />}
            </Field>
            <Field label="End" hint="Empty for a current role">
              {(id) => (
                <input id={id} value={job.end ?? ''} onChange={(e) => update(index, { end: e.target.value || null })} />
              )}
            </Field>
          </div>
          <Field label="What you did" hint="One per line. Drafts quote these; they never add to them.">
            {(id) => (
              <textarea
                id={id}
                rows={Math.max(3, job.bullets.length + 1)}
                value={job.bullets.join('\n')}
                onChange={(e) =>
                  update(index, {
                    bullets: e.target.value.split('\n').filter((line, i, all) => line.trim() || i === all.length - 1),
                  })
                }
              />
            )}
          </Field>
          <Button variant="danger" icon="close" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            Remove this role
          </Button>
        </fieldset>
      ))}
      <Button
        icon="plus"
        onClick={() => onChange([...value, { employer: '', title: '', start: '', end: null, bullets: [] }])}
      >
        Add a role
      </Button>
    </div>
  )
}

function Vault() {
  const [answers, setAnswers] = useState<VaultAnswer[] | null>(null)
  const [state, setState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.answers().then(setAnswers, (e: Error) => setState({ tone: 'error', text: e.message }))
  }, [])
  if (!answers) return state ? <Notice tone="error">{state.text}</Notice> : <div className="skeleton" />

  const update = (index: number, patch: Partial<VaultAnswer>) => {
    setState(null)
    setAnswers(answers.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }
  const save = async () => {
    setBusy(true)
    try {
      const clean = answers
        .filter((entry) => entry.question.trim())
        .map((entry) => ({ ...entry, key: entry.key || slugKey(entry.question) }))
      setAnswers(await api.saveAnswers(clean))
      setState({ tone: 'ok', text: 'Saved. The extension uses these the next time you press Fill.' })
    } catch (e) {
      setState({ tone: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="lede">
        Your answers to the questions forms ask. The extension fills a question only when it clearly matches one here;
        anything else it leaves for you.
      </p>
      <table className="vault">
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col">Your answer</th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {answers.map((entry, index) => (
            <tr key={index}>
              <td>
                <textarea
                  aria-label="Question"
                  rows={2}
                  value={entry.question}
                  onChange={(e) => update(index, { question: e.target.value, key: '' })}
                />
              </td>
              <td>
                <textarea
                  aria-label="Answer"
                  rows={2}
                  value={entry.answer}
                  onChange={(e) => update(index, { answer: e.target.value })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove “${entry.question}”`}
                  onClick={() => setAnswers(answers.filter((_, i) => i !== index))}
                >
                  <Icon name="close" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!answers.length && (
        <p className="muted">
          No answers yet. Add the questions you are asked again and again: sponsorship, notice period, how you heard
          about the job.
        </p>
      )}
      <div className="row-actions">
        <Button icon="plus" onClick={() => setAnswers([...answers, { key: '', question: '', answer: '' }])}>
          Add a question
        </Button>
        <Button variant="primary" busy={busy} onClick={save}>
          Save answers
        </Button>
      </div>
      {state && <Notice tone={state.tone}>{state.text}</Notice>}
    </div>
  )
}

export function Profile() {
  const [data, setData] = useState<{
    profile: ProfileData | null
    masterResumePath: string
    masterResumeFound: boolean
  } | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.profile().then(
      (result) => {
        setData(result)
        setProfile(result.profile ?? { name: '', email: '', education: [], experience: [], skills: [], links: [] })
      },
      (e: Error) => setError(e.message),
    )
  }, [])

  if (!profile || !data)
    return (
      <div className="page">
        {error ? <Notice tone="error">{error}</Notice> : <div className="skeleton skeleton-title" />}
      </div>
    )
  const set = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
    setSaved(false)
    setProfile({ ...profile, [key]: value })
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const clean = {
        ...profile,
        experience: profile.experience.map((job) => ({ ...job, bullets: job.bullets.filter((b) => b.trim()) })),
      }
      setProfile((await api.saveProfile(clean)).profile)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const links = profile.links ?? []

  return (
    <div className="page">
      <h1>Profile &amp; answers</h1>
      <p className="lede">
        Everything here stays in this folder. Drafts and the extension use only what you write here and in your master
        resume.
      </p>

      <form onSubmit={submit}>
        <section className="group">
          <h2>You</h2>
          <div className="grid-2">
            <Field label="Full name">
              {(id) => (
                <input id={id} value={profile.name} autoComplete="name" onChange={(e) => set('name', e.target.value)} />
              )}
            </Field>
            <Field label="Email">
              {(id) => (
                <input
                  id={id}
                  type="email"
                  value={profile.email}
                  autoComplete="email"
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>
            <Field label="Phone">
              {(id) => (
                <input
                  id={id}
                  type="tel"
                  value={profile.phone ?? ''}
                  autoComplete="tel"
                  onChange={(e) => set('phone', e.target.value)}
                />
              )}
            </Field>
            <Field label="Location">
              {(id) => (
                <input id={id} value={profile.location ?? ''} onChange={(e) => set('location', e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="One-line headline" hint="Used to open the templated cover letter.">
            {(id) => <input id={id} value={profile.headline ?? ''} onChange={(e) => set('headline', e.target.value)} />}
          </Field>
          <Field label="Work authorization" hint="In your words, e.g. “Canadian citizen”.">
            {(id) => (
              <input
                id={id}
                value={profile.workAuthorization ?? ''}
                onChange={(e) => set('workAuthorization', e.target.value)}
              />
            )}
          </Field>
          <div className="field">
            <span className="label">Links</span>
            <div className="stack-tight">
              {links.map((link, index) => (
                <div className="link-row" key={index}>
                  <input
                    aria-label="Link label"
                    placeholder="GitHub"
                    value={link.label}
                    onChange={(e) =>
                      set(
                        'links',
                        links.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)),
                      )
                    }
                  />
                  <input
                    aria-label="Link URL"
                    type="url"
                    placeholder="https://"
                    value={link.url}
                    onChange={(e) =>
                      set(
                        'links',
                        links.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${link.label || 'link'}`}
                    onClick={() =>
                      set(
                        'links',
                        links.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              <Button icon="plus" onClick={() => set('links', [...links, { label: '', url: '' }])}>
                Add a link
              </Button>
            </div>
          </div>
        </section>

        <section className="group">
          <h2>Master resume</h2>
          <p className={data.masterResumeFound ? 'verified' : 'notice notice-error'}>
            {data.masterResumeFound ? <Icon name="check" size={16} /> : null}
            {data.masterResumeFound ? 'Found at ' : 'Not found at '}
            <code>{data.masterResumePath}</code>
          </p>
          <Field
            label="Path, relative to this folder"
            hint="Your full resume in Markdown. Edit it in any editor; drafts select and reorder from it."
          >
            {(id) => (
              <input
                id={id}
                value={profile.masterResume ?? 'master-resume.md'}
                onChange={(e) => set('masterResume', e.target.value)}
              />
            )}
          </Field>
          <ListEditor
            label="Skills"
            values={profile.skills}
            onChange={(v) => set('skills', v)}
            placeholder="TypeScript"
            hint="Skills found in a description add to its score."
          />
        </section>

        <section className="group">
          <h2>Experience</h2>
          <ExperienceEditor value={profile.experience} onChange={(v) => set('experience', v)} />
        </section>

        <div className="savebar">
          {error && <Notice tone="error">{error}</Notice>}
          {saved && <Notice tone="ok">Saved to profile.json.</Notice>}
          <Button variant="primary" type="submit" busy={busy}>
            Save profile
          </Button>
        </div>
      </form>

      <section className="group">
        <h2>Answer vault</h2>
        <Vault />
      </section>
    </div>
  )
}
