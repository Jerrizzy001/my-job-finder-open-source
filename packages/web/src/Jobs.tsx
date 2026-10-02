import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type JobDetail, type ListedJob, type Reason, type Stage } from './api.ts'
import { Button, Icon, Notice } from './ui.tsx'

const TABS: { stage: Stage; label: string; always: boolean }[] = [
  { stage: 'for_you', label: 'For you', always: true },
  { stage: 'drafted', label: 'Drafted', always: true },
  { stage: 'applied', label: 'Applied', always: true },
  { stage: 'pending', label: 'Waiting for a description', always: false },
  { stage: 'dismissed', label: 'Not for me', always: false },
]

function scoreTone(score: number): string {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low'
}

function place(job: ListedJob): string {
  const mode =
    job.workplaceType === 'onsite'
      ? 'On site'
      : job.workplaceType
        ? job.workplaceType[0]!.toUpperCase() + job.workplaceType.slice(1)
        : null
  const repeats = mode && job.location?.toLowerCase().includes(mode.toLowerCase())
  return [job.location, repeats ? null : mode].filter(Boolean).join(' · ') || 'Location not stated'
}

/** Two panes from 900px; below that the list and the detail take turns. */
function useWide(): boolean {
  const query = '(min-width: 900px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setWide(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return wide
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ol className="reasons">
      {reasons.map((reason, index) => (
        <li key={index} className={`reason reason-${reason.kind}`}>
          <span className="reason-sign" aria-hidden="true">
            {reason.kind === 'plus' ? '+' : reason.kind === 'minus' || reason.kind === 'fail' ? '−' : '·'}
          </span>
          <span className="reason-text">{reason.text}</span>
          {reason.points !== undefined && reason.points !== 0 && (
            <span className="reason-points">{reason.points > 0 ? `+${reason.points}` : reason.points}</span>
          )}
        </li>
      ))}
    </ol>
  )
}

function Detail({ id, onChanged, onBack }: { id: number; onChanged: () => void; onBack: () => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [doc, setDoc] = useState<'resume' | 'cover'>('resume')
  const heading = useRef<HTMLHeadingElement>(null)

  const load = useCallback(() => {
    setError(null)
    api.job(id).then(setDetail, (e: Error) => setError(e.message))
  }, [id])
  useEffect(() => {
    setDetail(null)
    load()
  }, [load])

  const act = useCallback(
    async (name: string, work: () => Promise<unknown>) => {
      setBusy(name)
      setError(null)
      try {
        await work()
        load()
        onChanged()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [load, onChanged],
  )

  const job = detail?.job.match ?? null
  const row = detail?.job

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey || !row) return
      if (event.key === 'd') void act('tailor', () => api.tailor(id))
      else if (event.key === 'x' && job?.stage !== 'dismissed') void act('dismiss', () => api.dismiss(id))
      else if (event.key === 'o') window.open(row.url, '_blank', 'noopener')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, id, job?.stage, row])

  if (error && !detail)
    return (
      <section className="detail">
        <Notice tone="error">{error}</Notice>
      </section>
    )
  if (!detail || !row)
    return (
      <section className="detail detail-loading" aria-busy="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton" />
        <div className="skeleton" />
      </section>
    )

  const files = `/api/jobs/${id}/files`
  return (
    <section className="detail" aria-labelledby="detail-title">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" /> All jobs
      </button>
      <header className="detail-head">
        {job && (
          <div className={`score score-${scoreTone(job.score)}`} aria-label={`Score ${job.score} of 100`}>
            {job.score}
          </div>
        )}
        <div>
          <h2 id="detail-title" ref={heading} tabIndex={-1}>
            {row.title}
          </h2>
          <p className="detail-meta">
            <strong>{row.company}</strong> · {job ? place(job) : row.location} ·{' '}
            <span className="source">{row.source}</span>
          </p>
        </div>
      </header>

      <div className="actions">
        <Button
          variant="primary"
          icon="sparkle"
          busy={busy === 'tailor'}
          onClick={() => act('tailor', () => api.tailor(id))}
          ariaKeyshortcuts="d"
        >
          {detail.draft ? 'Redraft' : 'Draft resume & cover letter'}
        </Button>
        <a className="btn btn-quiet" href={row.url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" /> <span>Open posting</span>
        </a>
        {job?.stage !== 'applied' && (
          <Button icon="check" busy={busy === 'applied'} onClick={() => act('applied', () => api.applied(id))}>
            I applied
          </Button>
        )}
        {job?.stage === 'dismissed' ? (
          <Button icon="undo" busy={busy === 'restore'} onClick={() => act('restore', () => api.restore(id))}>
            Bring back
          </Button>
        ) : (
          <Button
            variant="danger"
            icon="thumbDown"
            busy={busy === 'dismiss'}
            onClick={() => act('dismiss', () => api.dismiss(id))}
            title="Not for me: similar titles score lower"
            ariaKeyshortcuts="x"
          >
            Not for me
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <h3>Why this job</h3>
      {job ? (
        <ReasonList reasons={job.reasons} />
      ) : (
        <p className="muted">This posting has not been scored under your current preferences yet.</p>
      )}

      <h3>Your drafts</h3>
      {detail.draft ? (
        <div className="drafts">
          <div className="draft-bar">
            <div className="segmented" role="tablist" aria-label="Draft">
              <button role="tab" aria-selected={doc === 'resume'} onClick={() => setDoc('resume')}>
                Resume
              </button>
              <button role="tab" aria-selected={doc === 'cover'} onClick={() => setDoc('cover')}>
                Cover letter
              </button>
            </div>
            <a
              className="link"
              href={`${files}/${doc === 'resume' ? 'resume' : 'cover-letter'}.pdf`}
              target="_blank"
              rel="noopener"
            >
              <Icon name="file" /> PDF
            </a>
            <a
              className="link"
              href={`${files}/${doc === 'resume' ? 'resume' : 'cover-letter'}.md`}
              target="_blank"
              rel="noopener"
            >
              Markdown
            </a>
          </div>
          {detail.draft.verified ? (
            <p className="verified">
              <Icon name="check" size={16} /> Every name, number and date is from your resume or profile.
              {detail.draft.llmUsed
                ? ' Tailored by your model.'
                : ' No model: your master resume and a templated letter.'}
            </p>
          ) : (
            <Notice tone="error">Not verified. Read it before you use it: {detail.draft.problems.join('; ')}</Notice>
          )}
          {/* The server renders this from Markdown with every character escaped. */}
          <article
            className="paper"
            dangerouslySetInnerHTML={{
              __html: doc === 'resume' ? detail.draft.resumeHtml : detail.draft.coverLetterHtml,
            }}
          />
        </div>
      ) : (
        <p className="muted">
          No draft yet. Drafting reads your master resume and profile, and never adds anything that is not in them.
        </p>
      )}

      {row.description && (
        <details className="description">
          <summary>The posting’s description</summary>
          <div className="description-text">{row.description}</div>
        </details>
      )}
    </section>
  )
}

export function Jobs({ refreshKey, onDiscover }: { refreshKey: number; onDiscover: () => void }) {
  const [jobs, setJobs] = useState<ListedJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('for_you')
  const [selected, setSelected] = useState<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wide = useWide()

  const load = useCallback(() => {
    api.jobs('all').then(
      (all) => {
        setJobs(all)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [])
  useEffect(load, [load, refreshKey])

  const counts = useMemo(() => {
    const result: Record<Stage, number> = { for_you: 0, drafted: 0, applied: 0, pending: 0, dismissed: 0 }
    for (const job of jobs ?? []) result[job.stage]++
    return result
  }, [jobs])
  const visible = useMemo(() => (jobs ?? []).filter((job) => job.stage === stage), [jobs, stage])

  // On a wide screen something is always open. A job you just drafted or applied to stays open
  // even though it moved to another tab, so the result of what you did is in front of you.
  useEffect(() => {
    if (wide && selected === null && visible.length) setSelected(visible[0]!.id)
  }, [visible, selected, wide])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (!['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key) || !visible.length) return
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !listRef.current?.contains(document.activeElement))
        return
      event.preventDefault()
      const index = visible.findIndex((job) => job.id === selected)
      const next =
        event.key === 'j' || event.key === 'ArrowDown'
          ? Math.min(visible.length - 1, index + 1)
          : Math.max(0, index - 1)
      setSelected(visible[next]!.id)
      listRef.current?.querySelectorAll<HTMLButtonElement>('.row')[next]?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selected])

  return (
    <div className={`jobs ${selected !== null ? 'has-selection' : ''}`}>
      <div className="list-pane">
        <div className="tabs" role="tablist" aria-label="Stage">
          {TABS.filter((tab) => tab.always || counts[tab.stage] > 0 || stage === tab.stage).map((tab) => (
            <button
              key={tab.stage}
              role="tab"
              aria-selected={stage === tab.stage}
              className={tab.always ? '' : 'tab-quiet'}
              onClick={() => {
                setStage(tab.stage)
                setSelected(null)
              }}
            >
              {tab.label} <span className="count">{counts[tab.stage]}</span>
            </button>
          ))}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {jobs === null && !error && (
          <div className="list-loading" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="skeleton skeleton-row" key={i} />
            ))}
          </div>
        )}
        {jobs !== null && !visible.length && (
          <div className="empty">
            {stage === 'for_you' ? (
              <>
                <p>
                  <strong>No matches waiting.</strong> Read the boards to look for new postings, or widen the roles and
                  places in Preferences.
                </p>
                <Button variant="primary" icon="refresh" onClick={onDiscover}>
                  Read the boards now
                </Button>
              </>
            ) : stage === 'drafted' ? (
              <p>
                Drafts appear here once you draft a resume and cover letter for a job, or run{' '}
                <code>jobfinder tailor</code>.
              </p>
            ) : stage === 'applied' ? (
              <p>Jobs you mark as applied, here or in the extension, are kept here even after the posting closes.</p>
            ) : (
              <p>Nothing here.</p>
            )}
          </div>
        )}
        <ul className="rows" ref={listRef}>
          {visible.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className="row"
                aria-current={job.id === selected || undefined}
                onClick={() => setSelected(job.id)}
              >
                <span className={`row-score score-${scoreTone(job.score)}`}>
                  {job.status === 'pending' ? '—' : job.score}
                </span>
                <span className="row-main">
                  <span className="row-title">{job.title}</span>
                  <span className="row-meta">
                    {job.company} · {place(job)}
                  </span>
                  <span className="row-why">
                    {job.reasons.find((reason) => reason.kind === 'plus')?.text ?? job.reasons[0]?.text}
                  </span>
                </span>
                {job.draftDir && <span className="tag">{job.draftVerified ? 'Drafted' : 'Check draft'}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="detail-pane">
        {selected !== null ? (
          <Detail key={selected} id={selected} onChanged={load} onBack={() => setSelected(null)} />
        ) : jobs?.length ? (
          <p className="muted pad">Pick a job to see why it matched.</p>
        ) : null}
      </div>
    </div>
  )
}
