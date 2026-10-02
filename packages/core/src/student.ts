/**
 * Student markers are one level.
 *
 * Employers write "this job is for a student" a dozen ways: intern,
 * internship, co-op, coop, co-operative education, work term, PEY
 * (Professional Experience Year), placement, summer student, or a plain
 * "Student" before or after the role. They all mean the same level, so
 * "Software Developer, Work Term" and a saved "Software developer co-op"
 * compare as the same title.
 *
 * Two of those words also name what a job *serves*: "Student Success Manager"
 * and "Placement Specialist" are jobs about students, not jobs for them. So
 * "student" and "placement" count only where they qualify the role:
 * - at the end of the title or of one comma/dash/bracket part
 *   ("Software Developer, Student", "Developer (Placement)"),
 * - after a season ("Summer Student"),
 * - or leading, directly before a role word ("Student Software Developer").
 *
 * This file reads the title with its punctuation still in place, because the
 * punctuation is what tells "Developer, Student" from "Student Developer
 * Relations Lead".
 */

const ALWAYS = String.raw`intern(?:ship)?s?|co[ -]?op|co-?operative education|work[ -]terms?|pey|professional experience year`
const SEASON = String.raw`(?:summer|fall|autumn|winter|spring)\s+students?`
/** A word before "student"/"placement" that makes it the subject of the job. */
const SUBJECT_BEFORE = String.raw`international|prospective|future|student|graduate|campus|patient|career|for|of|with|to`
const QUALIFIER = String.raw`(?<!\b(?:${SUBJECT_BEFORE})[ -])(?:students?|placement)(?=\s*(?:$|[,()[\]/|:\u2013\u2014-]))`
/** Role words a leading "Student" may qualify. */
const ROLE_WORD = String.raw`software|web|full[ -]?stack|front[ -]?end|back[ -]?end|mobile|data|ai|machine|ml|cloud|devops|qa|quality|test|security|cyber\w*|research|developer|engineer\w*|programmer|analyst|scientist|technical|technology|systems?|product|ux|ui|game|embedded|firmware|hardware|network|database|business|finance|marketing|design\w*`
const LEADING = String.raw`(?<=(?:^|[,(\[/|:\u2013\u2014-])\s*)students?(?=\s+(?:${ROLE_WORD})\b)`

const MARKER_SOURCE = String.raw`\b(?:${SEASON}|${ALWAYS}|${QUALIFIER}|${LEADING})\b`
const markerTest = new RegExp(MARKER_SOURCE, 'i')
const markerAll = new RegExp(MARKER_SOURCE, 'gi')

/** Term words that ride along with a student marker: seasons, years, lengths. */
const TERM_WORDS = /\b(?:summer|fall|autumn|winter|spring|20\d\d|\d{1,2}[ -]?months?|term)\b/gi

/** Lower case with accents off; punctuation kept. */
function fold(title: string): string {
  return title
    .slice(0, 300)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Whether a title is written for a student (any marker, any form). */
export function isStudentTitle(title: string): boolean {
  return markerTest.test(fold(title))
}

export type StudentLevel = {
  /** True when the title carries a student marker. */
  student: boolean
  /** The title with student markers (and term words, when student) removed. */
  rest: string
}

/**
 * The level a title is at, and the title without its markers.
 *
 * `rest` keeps its punctuation; pass it through `normalizeTitle` to compare.
 */
export function studentLevel(title: string): StudentLevel {
  const folded = fold(title)
  if (!markerTest.test(folded)) return { student: false, rest: folded }
  const rest = folded.replace(markerAll, ' ').replace(TERM_WORDS, ' ')
  return { student: true, rest: rest.replace(/\s+/g, ' ').trim() }
}

/**
 * A student search: every saved title is student-level. Such a search never
 * matches a title that is not. A search mixing both reads each saved title at
 * its own level.
 */
export function isStudentSearch(roleTitles: readonly string[]): boolean {
  return roleTitles.length > 0 && roleTitles.every(isStudentTitle)
}
