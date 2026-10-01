/**
 * Role families: what kind of work a title names.
 *
 * String equality fails both ways. "Applied AI Program Design & Delivery
 * Intern" shares no word with a saved "AI engineer intern" but is the same
 * kind of work; "AI Sales Intern" shares two words with it and is not. So a
 * title is first read for its family, by a short list of recognisers that run
 * in order (the first hit wins):
 *
 * 1. non-technical work written with a technical word in it ("AI Sales",
 *    "Technical Support Engineer", "Student Success Manager");
 * 2. technical work, named by a role word ("Software", "Data Engineer", "MLOps");
 * 3. non-technical work ("Financial Analyst", "Marketing");
 * 4. weak technical words ("AI", "Data") that only count when nothing else
 *    named the work.
 *
 * Every pattern reads `normalizeTitle` output: lower case, punctuation as
 * spaces, "machine learning" as "ml", "co-op" as "coop".
 */

export const TECH_FAMILIES = [
  'software',
  'web',
  'mobile',
  'data',
  'ai_ml',
  'devops_cloud',
  'qa_test',
  'security',
  'embedded',
] as const

/** Recognised and searchable, but never reached from a technical search. */
export const ADJACENT_FAMILIES = ['product', 'ux_design'] as const

export const OTHER_FAMILIES = [
  'ai_nontech',
  'it_support',
  'it_systems',
  'education_services',
  'hr_recruiting',
  'marketing',
  'sales',
  'finance',
  'risk_compliance',
  'business_analysis',
  'operations',
  'other_engineering',
] as const

export type TechFamily = (typeof TECH_FAMILIES)[number]
export type RoleFamily =
  | TechFamily
  | (typeof ADJACENT_FAMILIES)[number]
  | (typeof OTHER_FAMILIES)[number]

export const FAMILY_LABELS: Record<RoleFamily, string> = {
  software: 'software development',
  web: 'web and front-end',
  mobile: 'mobile development',
  data: 'data',
  ai_ml: 'AI and machine learning',
  devops_cloud: 'DevOps, cloud and SRE',
  qa_test: 'QA and testing',
  security: 'security engineering',
  embedded: 'embedded and firmware',
  product: 'product and program management',
  ux_design: 'UX and design',
  ai_nontech: 'non-technical AI work',
  it_support: 'IT and technical support',
  it_systems: 'IT systems',
  education_services: 'student and career services',
  hr_recruiting: 'HR and recruiting',
  marketing: 'marketing and communications',
  sales: 'sales and business development',
  finance: 'finance',
  risk_compliance: 'risk and compliance',
  business_analysis: 'business analysis',
  operations: 'operations and strategy',
  other_engineering: 'non-software engineering',
}

/**
 * Which other families a search in one family also reaches (the `family`
 * tier, at fewer points than the same family). A software search reaches all
 * technical work; a data search stays in data.
 */
export const FAMILY_REACH: Partial<Record<RoleFamily, readonly RoleFamily[]>> = {
  software: ['web', 'mobile', 'data', 'ai_ml', 'devops_cloud', 'qa_test', 'security', 'embedded'],
  web: ['software', 'mobile'],
  mobile: ['software', 'web'],
  data: [],
  ai_ml: ['data', 'software'],
  devops_cloud: ['software', 'security'],
  qa_test: ['software'],
  security: ['devops_cloud', 'software'],
  embedded: ['software'],
}

type Recogniser = readonly [RoleFamily, RegExp]

/** 1. Non-technical work with a technical word in it. Beats every later rule. */
const OVERRIDES: readonly Recogniser[] = [
  [
    'it_support',
    /\b(?:technical support|tech support|it support|desktop support|help ?desk|service desk|support (?:engineer\w*|analyst|specialist)|application support|customer support)\b/,
  ],
  [
    'ai_nontech',
    /\bai (?:sales|marketing|recruit\w*|talent|ethics|policy|governance|trainer|tutor|content|writer|writing|evangelist|adoption|operations|annotat\w*|literacy|strategy|partnerships?)\b/,
  ],
  [
    'education_services',
    /\bstudent (?:success|services|affairs|life|recruit\w*|advis\w*|experience|engagement|support|ambassador)\b|\bplacement (?:specialist|coordinator|officer|advis\w*|manager)\b|\b(?:career|coop) (?:advis\w*|coordinator|consultant|educator)\b/,
  ],
  [
    'hr_recruiting',
    /\b(?:recruit\w*|talent acquisition|human resources|hr|people (?:partner|operations)|payroll)\b/,
  ],
  [
    'product',
    /\b(?:product manag\w*|product owner|program manag\w*|project manag\w*|project coordinat\w*|scrum master)\b/,
  ],
  [
    'ux_design',
    /\b(?:ux|user experience|user research\w*|designer|(?:product|graphic|visual|interaction|brand|motion) design)\b/,
  ],
  ['marketing', /\b(?:web|website|digital) content\b|\bdeveloper (?:relations|advocate|marketing)\b/],
  ['sales', /\b(?:business|sales|market|partner\w*|fund|community) development\b|\bsales engineer\w*\b/],
]

/** 2. Technical work, named by a role word. */
const TECH: readonly Recogniser[] = [
  [
    'qa_test',
    /\b(?:qa|sdet|test automation|automation test\w*|software test\w*|tester|testers|(?:developer|engineer) in test|quality engineer\w*)\b/,
  ],
  [
    'security',
    /\b(?:cyber ?security|security (?:engineer\w*|analyst|developer|research\w*|software|operations)|appsec|application security|infosec|penetration test\w*|pentest\w*|red team|soc analyst)\b/,
  ],
  ['mobile', /\b(?:ios|android|react native|flutter|mobile)\b/],
  ['embedded', /\b(?:embedded|firmware)\b/],
  [
    'ai_ml',
    /\b(?:ml|deep learning|computer vision|nlp|natural language processing|llms?|genai|generative ai|applied ai|mlops|prompt engineer\w*|large language models?|conversational ai|reinforcement learning|ai (?:engineer\w*|developer|scien\w*|research\w*|agents?|platform|infrastructure|automation|solutions? (?:engineer\w*|developer|architect)|product (?:developer|engineer\w*)|program|systems|applications?|models?|modell?ing))\b/,
  ],
  [
    'data',
    /\b(?:data (?:scien\w*|engineer\w*|analy\w*|platform|pipelines?|warehous\w*|infrastructure|visuali[sz]ation)|analytics engineer\w*|business intelligence|bi (?:developer|analyst|engineer\w*)|power bi|tableau|etl|databases?|dba|sql developer)\b/,
  ],
  [
    'devops_cloud',
    /\b(?:devops|sre|reliability engineer\w*|cloud|platform engineer\w*|infrastructure engineer\w*|kubernetes|build and release)\b/,
  ],
  ['web', /\b(?:web|frontend|react|angular|vue|javascript|typescript)\b/],
  [
    'software',
    /\b(?:software|backend|fullstack|developers?|programmers?|coder|java|python|golang|c\+\+|c#|compiler|kernel)\b/,
  ],
]

/** 3. Non-technical work. */
const NON_TECH: readonly Recogniser[] = [
  [
    'other_engineering',
    /\b(?:mechanical|electrical|civil|chemical|manufacturing|industrial|structural|aerospace|materials|environmental|biomedical|mechatronics|hardware|asic|fpga|pcb|analog|silicon|process engineer\w*)\b/,
  ],
  ['business_analysis', /\bbusiness (?:\w+ )?analyst\b|\bbusiness process\b|\bchange management\b/],
  [
    'finance',
    /\b(?:financ\w*|accounting|accountant|audit\w*|tax|treasury|investment\w*|banking|actuar\w*|underwrit\w*|credit|wealth|trading|insurance)\b/,
  ],
  ['risk_compliance', /\b(?:risk|fraud|compliance|aml|kyc|regulatory)\b/],
  [
    'marketing',
    /\b(?:marketing|communications?|social media|content|brand|public relations|seo|copywrit\w*|advertising|media|events?)\b/,
  ],
  [
    'sales',
    /\b(?:sales|account executive|account manag\w*|partnerships?|customer success)\b/,
  ],
  [
    'operations',
    /\b(?:operations|strategy|supply chain|logistics|procurement|administrative|office|clerk|data entry)\b/,
  ],
  [
    'it_systems',
    /\b(?:it|information technology|network (?:engineer\w*|administrat\w*|analyst)|systems? administrat\w*|sysadmin)\b/,
  ],
]

/** 4. Weak technical words. */
const WEAK_TECH: readonly Recogniser[] = [
  ['ai_ml', /\bai\b/],
  ['data', /\bdata\b/],
]

const RECOGNISERS: readonly Recogniser[] = [...OVERRIDES, ...TECH, ...NON_TECH, ...WEAK_TECH]

/** The family a normalised title names, or `null` when it names none. */
export function classifyFamily(normalizedTitle: string): RoleFamily | null {
  for (const [family, pattern] of RECOGNISERS) if (pattern.test(normalizedTitle)) return family
  return null
}

const TECH_SET: ReadonlySet<RoleFamily> = new Set(TECH_FAMILIES)

export function isTechFamily(family: RoleFamily | null): family is TechFamily {
  return family !== null && TECH_SET.has(family)
}

/** How a search in `saved` reaches a job in `job`: same family, a neighbour, or not. */
export function familyReach(saved: RoleFamily, job: RoleFamily): 'same' | 'neighbour' | null {
  if (saved === job) return 'same'
  return FAMILY_REACH[saved]?.includes(job) ? 'neighbour' : null
}

/**
 * Words that make an otherwise unclassified title worth a second look from a
 * technical search ("Technology Analyst Intern", "Digital Systems Co-op").
 * Such a title is `related`: kept until its description is read.
 */
const RELATED_WORDS =
  /\b(?:technology|technical|tech|digital|systems?|computer|computing|engineering|automation|analytics|innovation|solutions)\b/

export function looksRelated(normalizedTitle: string, family: RoleFamily | null): boolean {
  if (family === 'it_systems') return true
  return family === null && RELATED_WORDS.test(normalizedTitle)
}
