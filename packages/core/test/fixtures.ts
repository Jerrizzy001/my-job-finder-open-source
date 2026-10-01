import type { Job, Preferences } from '../src/index.ts'

export function job(overrides: Partial<Job> = {}): Job {
  return {
    title: 'Software Developer Co-op',
    company: 'Example Co',
    location: 'Toronto, ON, Canada',
    workplaceType: null,
    description: null,
    url: 'https://example.com/jobs/1',
    source: 'test',
    ...overrides,
  }
}

export const studentPrefs: Preferences = {
  roleTitles: ['AI engineer intern', 'Software developer intern'],
  locations: ['Toronto'],
  remoteRegions: ['Canada'],
  workModes: [],
  graduation: '2027-04',
  blockedCompanies: [],
  blockedTerms: [],
}

export const SOFTWARE_DESCRIPTION = `About the role
Join our engineering team for a four-month co-op term, Winter 2027.
- Build and test features in TypeScript and React for our web application.
- Write Node.js services and Python scripts, and query PostgreSQL with SQL.
- Deploy to AWS and review pull requests with senior engineers.
We look for students in Computer Science with Git and API experience.`

export const BUSINESS_DESCRIPTION = `About the role
Join our strategy team for a four-month co-op term, Winter 2027.
- Gather business requirements from stakeholders and document processes.
- Prepare status reports, meeting minutes and PowerPoint presentations.
- Support vendor evaluation and change management. Computer science degree a plus.
We look for students in Commerce or Economics with strong Excel skills.`
