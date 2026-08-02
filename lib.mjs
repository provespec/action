// Pure spec logic for the public ProveSpec MCP server: no I/O, no protocol, so
// it can be exercised directly by test.mjs.

export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export const pathOf = (entry) => (entry.path ?? []).map((p) => String(p).trim()).filter(Boolean)
export const pathKey = (path) => path.map(norm).join(' > ')

export const STATUSES = ['yes', 'partial', 'no', 'na']

/** Accepts ["A","B"], "A > B", or "A/B" — agents write all three. */
export function toPath(value) {
  if (Array.isArray(value)) return value.map((p) => String(p).trim()).filter(Boolean)
  return String(value)
    .split(/\s*(?:>|\/|»)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Entries under a scope: the top-level group, matched case-insensitively. */
export function inScope(entries, scope) {
  if (!scope) return entries
  const want = norm(scope)
  const hit = entries.filter((e) => norm(pathOf(e)[0] ?? '') === want)
  if (hit.length === 0) {
    const groups = [...new Set(entries.map((e) => pathOf(e)[0]).filter(Boolean))]
    throw new Error(`Scope "${scope}" not found. Groups in this spec: ${groups.join(', ')}`)
  }
  return hit
}

/** Sections → subsections → leaves, for readable output. */
export function outline(entries) {
  const sections = []
  for (const entry of entries) {
    const path = pathOf(entry)
    if (!path.length) continue
    const leaf = path[path.length - 1]
    const sectionName = path.length > 1 ? path[0] : '—'
    const subName = path.length > 2 ? path.slice(1, -1).join(' · ') : ''

    let section = sections.find((s) => s.name === sectionName)
    if (!section) sections.push((section = { name: sectionName, subs: [] }))
    let sub = section.subs.find((s) => s.name === subName)
    if (!sub) section.subs.push((sub = { name: subName, leaves: [] }))
    sub.leaves.push({ path, name: leaf, value: entry.value ?? '', note: entry.note ?? '' })
  }
  return sections
}

/**
 * Grade leaves against the spec. Mirrors the desktop app's parity relation:
 * parity = fully-has / spec-declares, n/a excluded from both sides, and
 * anything ungraded counts as missing — silence is not credit.
 */
export function grade(entries, grades) {
  const byKey = new Map()
  for (const g of grades) {
    const path = toPath(g.path)
    if (!path.length) continue
    byKey.set(pathKey(path), { status: g.status, note: g.note ?? '' })
  }

  const missing = []
  const partial = []
  const ungraded = []
  let declares = 0
  let has = 0
  const matched = new Set()

  for (const entry of entries) {
    const path = pathOf(entry)
    if (!path.length) continue
    if (entry.status === 'na') continue // the spec itself marks it not applicable

    const key = pathKey(path)
    const g = byKey.get(key)
    if (g) matched.add(key)

    if (!g) {
      declares++
      ungraded.push({ path, note: entry.note ?? '' })
      continue
    }
    if (g.status === 'na') continue // graded not-applicable: out of the denominator
    declares++
    if (g.status === 'yes') has++
    else if (g.status === 'partial') partial.push({ path, note: g.note })
    else missing.push({ path, note: g.note })
  }

  // Grades matching nothing in the spec are capabilities beyond it — not defects.
  const beyondSpec = grades.map((g) => toPath(g.path)).filter((p) => p.length && !matched.has(pathKey(p)))

  return {
    parityPct: declares === 0 ? null : Math.round((has / declares) * 100),
    totals: {
      declares,
      has,
      missing: missing.length,
      partial: partial.length,
      ungraded: ungraded.length,
      beyondSpec: beyondSpec.length
    },
    missing,
    partial,
    ungraded,
    beyondSpec
  }
}

export function reportMarkdown({ spec, slug, scope, result, product, site }) {
  const lines = []
  const list = (items) =>
    items.length ? items.map((i) => `- **${i.path.join(' > ')}**${i.note ? ` — _${i.note}_` : ''}`) : ['_None._']

  lines.push(`# Parity report — ${spec.title ?? slug}${scope ? ` (scope: ${scope})` : ''}`)
  lines.push('')
  lines.push(`Implementation: **${product ?? 'your build'}** · spec: ${site}/catalog/${slug}/`)
  lines.push('')
  lines.push(
    `Parity: **${result.parityPct === null ? 'n/a' : `${result.parityPct}%`}** — has ${result.totals.has} of ${result.totals.declares} specified capabilities.`
  )
  lines.push('')
  lines.push(`## Missing (${result.missing.length})`)
  lines.push(...list(result.missing))
  lines.push('')
  lines.push(`## Partial (${result.partial.length})`)
  lines.push(...list(result.partial))
  lines.push('')
  lines.push(`## Not yet graded (${result.ungraded.length})`)
  lines.push(...list(result.ungraded))
  if (result.beyondSpec.length) {
    lines.push('')
    lines.push(`## Beyond the spec (${result.beyondSpec.length})`)
    lines.push(...result.beyondSpec.map((p) => `- ${p.join(' > ')}`))
  }
  lines.push('')
  return lines.join('\n')
}
