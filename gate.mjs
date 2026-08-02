#!/usr/bin/env node
/**
 * The ProveSpec parity gate, as a GitHub Action step.
 *
 * Fetches a specification from the public catalog, grades this repository's
 * committed self-assessment against it, writes a job summary (and optionally a
 * badge), and fails the build when parity is below the floor or has regressed.
 *
 * Zero dependencies on purpose: it runs on the runner's Node with no install
 * step, so adopting it costs one workflow block and no supply chain.
 *
 * Exit codes: 0 pass · 1 gate failed · 2 misconfigured or not measurable.
 * We set process.exitCode rather than calling process.exit(): an explicit exit
 * while the HTTP socket is still closing aborts the process on Windows runners.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { badgeSvg, parityColor } from './badge.mjs'
import { evaluateGate } from './gate-rules.mjs'
import { grade, inScope, reportMarkdown } from './lib.mjs'

class GateError extends Error {}

const input = (name, fallback = '') => (process.env[`INPUT_${name}`] ?? '').trim() || fallback
const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v))

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT
  if (file) appendFileSync(file, `${key}=${value}\n`)
}

function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, markdown + '\n')
  else console.log(markdown)
}

async function main() {
  const SITE = input('SITE', 'https://provespec.com').replace(/\/+$/, '')
  const slug = input('SPEC')
  const gradesPath = input('GRADES', '.provespec/grades.json')
  const scope = input('SCOPE') || undefined
  const min = num(input('MIN'))
  const noRegression = input('NO_REGRESSION', 'false') === 'true'
  const tolerance = Number(input('TOLERANCE', '0')) || 0
  const badgePath = input('BADGE')

  if (!slug) throw new GateError('Input "spec" is required — the catalog slug to grade against.')
  if (!existsSync(gradesPath)) {
    throw new GateError(
      `No grades file at "${gradesPath}". Commit your self-assessment there, or point the "grades" input at it. ` +
        'Format: { "product": "...", "grades": [ { "path": ["AI","Model","Add todo"], "status": "yes", "note": "src/model.ts" } ] }'
    )
  }

  /* ── read the spec and the grades ───────────────────────────────────────── */

  const url = `${SITE}/catalog/${encodeURIComponent(slug)}/spec.json`
  let spec
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new GateError(`${url} → HTTP ${res.status}. Check the slug in the catalog at ${SITE}/catalog/`)
    spec = await res.json()
  } catch (err) {
    throw err instanceof GateError ? err : new GateError(`Could not fetch the specification: ${err.message}`)
  }

  let payload
  try {
    payload = JSON.parse(readFileSync(gradesPath, 'utf-8'))
  } catch (err) {
    throw new GateError(`${gradesPath} is not valid JSON: ${err.message}`)
  }

  const grades = Array.isArray(payload) ? payload : payload.grades
  if (!Array.isArray(grades) || grades.length === 0) {
    throw new GateError(`${gradesPath} has no "grades" array.`)
  }
  const product = payload.product ?? process.env.GITHUB_REPOSITORY ?? 'this build'
  const previous = payload.parity === undefined ? null : num(String(payload.parity))

  /* ── grade ──────────────────────────────────────────────────────────────── */

  let entries
  try {
    entries = inScope(spec.entries ?? [], scope)
  } catch (err) {
    throw new GateError(err.message)
  }

  const result = grade(entries, grades)
  const gate = evaluateGate({ current: result.parityPct, previous, min, noRegression, tolerance })
  const report = reportMarkdown({ spec, slug, scope, result, product, site: SITE })

  /* ── report ─────────────────────────────────────────────────────────────── */

  const reportPath = '.provespec-report.md'
  writeFileSync(reportPath, report)

  setOutput('parity', result.parityPct ?? '')
  setOutput('has', result.totals.has)
  setOutput('declares', result.totals.declares)
  setOutput('missing', result.totals.missing)
  setOutput('partial', result.totals.partial)
  setOutput('ungraded', result.totals.ungraded)
  setOutput('report', reportPath)

  if (badgePath) {
    mkdirSync(dirname(badgePath), { recursive: true })
    writeFileSync(
      badgePath,
      badgeSvg({
        label: scope ? `parity (${scope})` : 'parity',
        value: result.parityPct === null ? 'n/a' : `${result.parityPct}%`,
        color: parityColor(result.parityPct)
      })
    )
  }

  const verdict = gate.passed ? '✅ passed' : gate.exitCode === 2 ? '⚠️ not measurable' : '❌ failed'
  const delta = gate.delta === null ? '' : ` (${gate.delta >= 0 ? '+' : ''}${gate.delta} pts)`
  summary(
    [
      `## ProveSpec parity gate — ${verdict}`,
      '',
      `**${spec.title ?? slug}**${scope ? ` · scope ${scope}` : ''} → ` +
        `**${result.parityPct === null ? 'n/a' : `${result.parityPct}%`}**${delta}`,
      '',
      `${result.totals.has} of ${result.totals.declares} capabilities · ` +
        `${result.totals.missing} missing · ${result.totals.partial} partial · ` +
        `${result.totals.ungraded} ungraded · ${result.totals.beyondSpec} beyond spec`,
      '',
      ...(gate.reasons.length ? gate.reasons.map((r) => `> ${r}`) : []),
      '',
      '<details><summary>Full report</summary>',
      '',
      report,
      '',
      '</details>',
      '',
      `[Specification](${SITE}/catalog/${slug}/) · [ProveSpec](${SITE})`
    ].join('\n')
  )

  if (!gate.passed) {
    for (const reason of gate.reasons) console.error(`::error::${reason}`)
    const toClose = [...result.missing, ...result.ungraded].slice(0, 15)
    if (toClose.length) {
      console.error('::group::Capabilities to close')
      for (const item of toClose) console.error(`- ${item.path.join(' > ')}`)
      console.error('::endgroup::')
    }
    process.exitCode = gate.exitCode
    return
  }

  console.log(`ProveSpec: ${result.parityPct}% parity against ${spec.title ?? slug} — gate passed.`)
}

try {
  await main()
} catch (err) {
  console.error(`::error::${err.message}`)
  process.exitCode = 2
}
