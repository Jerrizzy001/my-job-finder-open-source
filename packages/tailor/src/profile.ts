/**
 * The profile: who you are, as you wrote it. Every fact in a draft must come
 * from here or from your master resume; nothing is invented.
 */

export type Link = { label: string; url: string }

export type Education = {
  school: string
  degree: string
  field?: string
  start?: string
  /** "2027-04", or a year. Also your expected graduation. */
  end?: string
  notes?: string[]
}

export type Experience = {
  employer: string
  title: string
  location?: string
  /** "2025-05" style. Kept exactly as written in every draft. */
  start: string
  /** null or "present" for a current role. */
  end: string | null
  bullets: string[]
}

export type Profile = {
  name: string
  email: string
  phone?: string
  location?: string
  headline?: string
  links?: Link[]
  education: Education[]
  experience: Experience[]
  skills: string[]
  /** As you would answer "Are you legally authorized to work in …?". */
  workAuthorization?: string
  /** Relative to the workspace. Default `master-resume.md`. */
  masterResume?: string
}

export function validateProfile(value: unknown): Profile {
  const problems: string[] = []
  const profile = (value ?? {}) as Partial<Profile>
  if (typeof profile.name !== 'string' || !profile.name.trim()) problems.push('"name" is required')
  if (typeof profile.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(profile.email))
    problems.push('"email" must be an email address')
  for (const key of ['education', 'experience', 'skills'] as const)
    if (profile[key] !== undefined && !Array.isArray(profile[key])) problems.push(`"${key}" must be a list`)
  ;(profile.experience ?? []).forEach((job, index) => {
    if (!job || typeof job.employer !== 'string' || typeof job.title !== 'string' || typeof job.start !== 'string')
      problems.push(`experience[${index}] needs employer, title and start`)
    else if (!Array.isArray(job.bullets)) problems.push(`experience[${index}].bullets must be a list`)
  })
  if (problems.length) throw new Error(`profile.json: ${problems.join('; ')}.`)
  return { education: [], experience: [], skills: [], ...profile } as Profile
}
