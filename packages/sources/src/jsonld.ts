import type { WorkMode } from '@jobfinder/core'
import { decodeEntities, htmlToText, isoDate, isRecord, joinPlaces, str } from './html.ts'

/**
 * schema.org `JobPosting` in JSON-LD: the structured data employers publish
 * on job pages for search engines. iCIMS pages carry it, and so do many
 * employers' own career sites, which is what the generic adapter reads.
 */

export type LdPosting = {
  title: string
  description: string | null
  location: string | null
  workplaceType: WorkMode | null
  postedAt: string | null
  employmentType: string | null
  url: string | null
  company: string | null
  identifier: string | null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  return asArray(node['@type']).some((value) => value === type)
}

/** Every JobPosting node in a page's JSON-LD blocks, including inside @graph and ItemList. */
export function findJobPostings(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const visit = (node: unknown, depth: number) => {
    if (depth > 6) return
    if (Array.isArray(node)) return node.forEach((child) => visit(child, depth + 1))
    if (!isRecord(node)) return
    if (hasType(node, 'JobPosting')) found.push(node)
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (key in node) visit(node[key], depth + 1)
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!.trim()), 0)
    } catch {
      // A malformed block is skipped; the page may have others.
    }
  }
  return found
}

function placeOf(value: unknown): string | null {
  if (!isRecord(value)) return str(value)
  const address = isRecord(value.address) ? value.address : value
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => (isRecord(part) ? str(part.name) : str(part)))
    .filter((part): part is string => !!part && part !== 'UNAVAILABLE')
  return parts.length ? parts.join(', ') : str(value.name)
}

export function readLdPosting(node: Record<string, unknown>): LdPosting | null {
  const title = str(typeof node.title === 'string' ? decodeEntities(node.title) : node.title)
  if (!title) return null
  const telecommute = asArray(node.jobLocationType).some((value) => String(value).toUpperCase() === 'TELECOMMUTE')
  const places = asArray(node.jobLocation).map(placeOf)
  const remoteRegions = asArray(node.applicantLocationRequirements).map(placeOf)
  const location = joinPlaces([
    ...places,
    ...(telecommute ? remoteRegions.map((region) => (region ? `Remote (${region})` : 'Remote')) : []),
  ])
  const org = isRecord(node.hiringOrganization) ? str(node.hiringOrganization.name) : str(node.hiringOrganization)
  const identifier = isRecord(node.identifier) ? str(node.identifier.value) : str(node.identifier)
  return {
    title,
    description: htmlToText(typeof node.description === 'string' ? node.description : null),
    location: location ?? (telecommute ? 'Remote' : null),
    workplaceType: telecommute ? 'remote' : null,
    postedAt: isoDate(node.datePosted),
    employmentType:
      asArray(node.employmentType)
        .map((value) => str(value))
        .filter(Boolean)
        .join(', ') || null,
    url: str(node.url, 2000),
    company: org,
    identifier,
  }
}
