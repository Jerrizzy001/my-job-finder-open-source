import type { RoleFamily } from './families.ts'

/**
 * Description evidence: what the posting's own text says the work is.
 *
 * A title alone can mislead. A finance internship whose description says
 * "computer science degree preferred" is still a finance internship, and a
 * "Technology Analyst Intern" can be either a coding job or a slide-deck job.
 * So the description is read for two vocabularies, the work a technical
 * search wants and the work it does not, and the counts decide.
 */

const TECH_TERMS: Partial<Record<RoleFamily, readonly string[]>> = {
  software: [
    'software',
    'code',
    'coding',
    'programming',
    'git',
    'api',
    'apis',
    'backend',
    'frontend',
    'algorithms',
    'data structures',
    'debugging',
    'unit tests',
    'code review',
    'pull requests',
    'typescript',
    'javascript',
    'python',
    'java',
    'c++',
    'c#',
    'go',
    'rust',
    'node.js',
    'react',
    'sql',
    'microservices',
    'ci/cd',
  ],
  web: ['html', 'css', 'react', 'vue', 'angular', 'typescript', 'javascript', 'next.js', 'web application'],
  mobile: ['ios', 'android', 'swift', 'kotlin', 'react native', 'flutter', 'mobile app'],
  data: [
    'sql',
    'etl',
    'data pipelines',
    'data warehouse',
    'spark',
    'airflow',
    'dbt',
    'pandas',
    'tableau',
    'power bi',
    'statistics',
    'dashboards',
  ],
  ai_ml: [
    'machine learning',
    'deep learning',
    'llm',
    'llms',
    'large language model',
    'generative ai',
    'nlp',
    'pytorch',
    'tensorflow',
    'model training',
    'fine-tuning',
    'prompt engineering',
    'rag',
    'embeddings',
    'computer vision',
  ],
  devops_cloud: [
    'aws',
    'azure',
    'gcp',
    'docker',
    'kubernetes',
    'terraform',
    'ci/cd',
    'linux',
    'observability',
    'infrastructure as code',
  ],
  qa_test: ['test automation', 'selenium', 'playwright', 'cypress', 'test cases', 'regression testing', 'unit tests'],
  security: [
    'vulnerability',
    'penetration testing',
    'threat modeling',
    'siem',
    'owasp',
    'incident response',
    'cryptography',
  ],
  embedded: ['firmware', 'microcontroller', 'rtos', 'embedded c', 'c++', 'hardware interfaces', 'i2c', 'spi'],
}

/** Work a technical search does not want, as a description describes it. */
const BUSINESS_TERMS: readonly string[] = [
  'stakeholders',
  'business requirements',
  'powerpoint',
  'excel',
  'meeting minutes',
  'status reports',
  'vendor',
  'change management',
  'sales',
  'marketing',
  'accounting',
  'financial statements',
  'audit',
  'customer service',
  'cold calling',
  'social media',
  'commerce',
  'economics',
  'presentations',
  'event planning',
]

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-term match: "go" does not hit "good", "c++" hits "C++". */
function hasTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escape(term)}(?![a-z0-9+#])`, 'i').test(text)
}

/** The distinct terms of `terms` that appear in `text`. */
export function termsIn(text: string, terms: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const term of terms) if (!seen.has(term.toLowerCase()) && hasTerm(text, term)) seen.add(term.toLowerCase())
  return [...seen]
}

/** The technical vocabulary for a set of families. */
export function techTermsFor(families: Iterable<RoleFamily>): string[] {
  const terms = new Set<string>()
  for (const family of families) for (const term of TECH_TERMS[family] ?? []) terms.add(term)
  return [...terms]
}

export type RelatedVerdict = {
  keep: boolean
  techTerms: string[]
  businessTerms: string[]
}

/**
 * The second look a `related` title gets: keep it when its description is
 * mostly the searched work. At least four distinct technical terms, and
 * clearly more of them than business terms.
 */
export function decideRelated(description: string, searched: Iterable<RoleFamily>): RelatedVerdict {
  const techTerms = termsIn(description, techTermsFor(searched))
  const businessTerms = termsIn(description, BUSINESS_TERMS)
  const keep = techTerms.length >= 4 && techTerms.length >= businessTerms.length * 1.5
  return { keep, techTerms, businessTerms }
}
