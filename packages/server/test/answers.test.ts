import { describe, expect, it } from 'vitest'
import { answerQuestions, type VaultAnswer } from '../src/index.ts'

const profile = {
  name: 'Sam Example',
  email: 'sam@example.com',
  phone: '+1 555 0100',
  location: 'Toronto, ON',
  links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/example' }],
  education: [],
  experience: [],
  skills: [],
}
const vault: VaultAnswer[] = [
  { key: 'sponsorship', question: 'Will you now or in the future require visa sponsorship?', answer: 'No' },
  { key: 'notice', question: 'What is your notice period?', answer: 'Two weeks' },
]

describe('answerQuestions', () => {
  it('answers profile fields by their label', () => {
    const answers = answerQuestions(
      [{ label: 'First name' }, { label: 'Last name' }, { label: 'LinkedIn URL' }, { label: 'Current location' }],
      profile,
      vault,
    )
    expect(answers.map((a) => a.answer)).toEqual([
      'Sam',
      'Example',
      'https://www.linkedin.com/in/example',
      'Toronto, ON',
    ])
  })

  it('uses a vault answer only for clearly the same question', () => {
    const [same, similar, other] = answerQuestions(
      [
        { label: 'Do you require visa sponsorship now or in the future?' },
        { label: 'Notice period' },
        { label: 'Are you willing to relocate?' },
      ],
      profile,
      vault,
    )
    expect(same).toMatchObject({ status: 'answered', answer: 'No', source: 'vault' })
    expect(similar).toMatchObject({ status: 'answered', answer: 'Two weeks' })
    expect(other).toMatchObject({ status: 'needs_user', answer: null })
  })

  it('never answers a choice question with a value that is not a choice', () => {
    const [answer] = answerQuestions(
      [{ label: 'Will you require visa sponsorship?', options: ['Yes', 'No, I am authorized'] }],
      profile,
      vault,
    )
    expect(answer!.status).toBe('needs_user')
  })
})
