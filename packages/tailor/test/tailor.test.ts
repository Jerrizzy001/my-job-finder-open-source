import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkDrafts,
  layout,
  reorderSkills,
  renderPdf,
  tailorDrafts,
  untailoredDrafts,
  validateProfile,
  verifyDraft,
  type Llm,
  type TailorInput,
} from '../src/index.ts'

const examples = join(import.meta.dirname, '..', '..', '..', 'examples')
const profile = validateProfile(JSON.parse(readFileSync(join(examples, 'profile.json'), 'utf8')))
const masterResume = readFileSync(join(examples, 'master-resume.md'), 'utf8')
const description = 'We build data pipelines in Python and Airflow on AWS. Kubernetes and Go experience required.'
const input: TailorInput = {
  profile,
  masterResume,
  job: { title: 'Backend Engineer', company: 'Acme Robotics', description },
  reasons: ['Title contains every word of "Backend Engineer".'],
  today: new Date('2026-10-01T12:00:00Z'),
}
const sources = [masterResume, JSON.stringify(profile), 'Acme Robotics', 'Backend Engineer']

describe('verifyDraft: nothing new may appear', () => {
  it('accepts a rephrased, reordered selection', () => {
    const draft =
      '# Sam Example\n\n## Experience\n\n### Software Engineer — Northwind Analytics\n2024-06 – present\n\n- Built an ingestion service in TypeScript and Node.js handling 2 million events a day'
    expect(verifyDraft({ draft, sources })).toEqual([])
  })

  it.each([
    ['an invented employer', '- Worked at Globex on billing', 'Globex'],
    ['an invented metric', '- Cut failed runs by 95%', '95%'],
    ['a changed date', '### Software Engineer\n2024-01 – present', '2024-01'],
    ['a changed date written as a month', 'Software Engineer since January 2024', '2024-01'],
    ['a skill only the job description names', '- Ran services on Kubernetes', 'Kubernetes'],
    ['an invented degree', '## Education\n- MSc, Computer Science', 'MSc'],
  ])('flags %s', (_, draft, value) => {
    expect(verifyDraft({ draft, sources }).map((p) => p.value)).toContain(value)
  })

  it('does not flag ordinary capitalised words that start a sentence or bullet', () => {
    expect(verifyDraft({ draft: '- Designed the schema. Shipped it with the team.', sources })).toEqual([])
  })
})

describe('the no-model package', () => {
  it('passes its own verification, names the company and role, and fits one page', () => {
    const drafts = untailoredDrafts(input)
    expect(drafts.problems).toEqual([])
    expect(drafts.verified).toBe(true)
    expect(drafts.coverLetter).toContain('Backend Engineer role at Acme Robotics')
    expect(drafts.coverLetter.match(/^- /gm)!.length).toBeGreaterThanOrEqual(2)
    expect(layout(drafts.coverLetter)).toHaveLength(1)
    expect(drafts.notes.join(' ')).toMatch(/No model was used/)
  })

  it('cites the bullets that share the most with the job', () => {
    expect(untailoredDrafts(input).coverLetter).toContain('Moved nightly reports from cron scripts to Airflow')
  })

  it('reorders only the skills line', () => {
    const reordered = reorderSkills(masterResume, description)
    expect(reordered.split('\n').filter((line, i) => line !== masterResume.split('\n')[i])).toHaveLength(1)
    expect(reordered).toMatch(/^Python, AWS, Airflow,/m)
  })
})

function fakeLlm(answers: string[]): Llm & { prompts: string[] } {
  const prompts: string[] = []
  return {
    model: 'fake-model',
    prompts,
    async complete({ user }) {
      prompts.push(user)
      return { text: answers.shift() ?? '{}', model: 'fake-model', usage: { promptTokens: 100, completionTokens: 50 } }
    },
  }
}

const goodCover =
  '# Sam Example\n\nDear Acme Robotics hiring team,\n\nI am applying for the Backend Engineer role at Acme Robotics.\n\n- Moved nightly reports from cron scripts to Airflow\n- Built a TypeScript and Node.js ingestion service\n\nSincerely,\nSam Example\n'

describe('with a model', () => {
  it('keeps a verified draft', async () => {
    const llm = fakeLlm([JSON.stringify({ resume_markdown: masterResume, cover_letter_markdown: goodCover })])
    const drafts = await tailorDrafts(input, llm)
    expect(drafts).toMatchObject({ llmUsed: true, verified: true, model: 'fake-model' })
  })

  it('retries once with the problems, then falls back to the no-model package', async () => {
    const invented = JSON.stringify({
      resume_markdown: `${masterResume}\n- Led Kubernetes migration at Globex`,
      cover_letter_markdown: goodCover,
    })
    const llm = fakeLlm([invented, invented])
    const drafts = await tailorDrafts(input, llm)
    expect(llm.prompts).toHaveLength(2)
    expect(llm.prompts[1]).toContain('Name not in your resume or profile: Globex')
    expect(drafts.llmUsed).toBe(false)
    expect(drafts.verified).toBe(true)
    expect(drafts.notes.join(' ')).toMatch(/discarded/)
    expect(drafts.usage).toHaveLength(2)
  })

  it('withholds the description from the model when the host opted out', async () => {
    const llm = fakeLlm([JSON.stringify({ resume_markdown: masterResume, cover_letter_markdown: goodCover })])
    await tailorDrafts({ ...input, job: { ...input.job, aiInput: false } }, llm)
    expect(llm.prompts[0]).not.toContain('Kubernetes')
    expect(llm.prompts[0]).toContain('withheld')
  })

  it('rejects a cover letter that does not name the company', () => {
    expect(checkDrafts(input, masterResume, '# Sam Example\n\nHello.\n')).toContain(
      'Cover letter: does not name the company',
    )
  })
})

describe('renderPdf', () => {
  it('writes a well-formed PDF whose xref offsets point at its objects', () => {
    const pdf = renderPdf(masterResume, { title: 'Resume', author: 'Sam Example' })
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    offsets.forEach((offset, index) => expect(text.startsWith(`${index + 1} 0 obj\n`, offset)).toBe(true))
    expect(text).toContain('(Sam Example)')
  })

  it('breaks long documents across pages', () => {
    const long = Array.from(
      { length: 120 },
      (_, i) => `- Bullet number ${i} with enough words to fill a line of text`,
    ).join('\n')
    expect(layout(long).length).toBeGreaterThan(1)
  })
})
