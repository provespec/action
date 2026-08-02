// Dependency-free tests: node test.mjs
// Runs gate.mjs as a real step (env-in, files-out) against the live catalog.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateGate } from './gate-rules.mjs'
import { badgeSvg, parityColor } from './badge.mjs'

const HERE = join(fileURLToPath(import.meta.url), '..')
const SITE = process.env.PROVESPEC_SITE ?? 'https://provespec.com'

let passed = 0
let skipped = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

// The end-to-end tests read a real spec over the network. If the catalog is
// unreachable that is an outage, not a defect in this action — skip loudly
// rather than turning CI red for someone else's incident.
const catalogUp = await fetch(`${SITE}/specs.json`, { signal: AbortSignal.timeout(15000) })
  .then((r) => r.ok)
  .catch(() => false)
const liveTest = (name, fn) => {
  if (!catalogUp) {
    console.warn(`SKIP ${name} — ${SITE} unreachable`)
    skipped++
    return
  }
  test(name, fn)
}

/** Run the action step in a scratch workspace; returns {code, out, err, summary, outputs}. */
function runGate(grades, inputs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'provespec-action-'))
  mkdirSync(join(dir, '.provespec'), { recursive: true })
  writeFileSync(join(dir, '.provespec', 'grades.json'), JSON.stringify(grades, null, 2))
  const outFile = join(dir, 'outputs.txt')
  const sumFile = join(dir, 'summary.md')

  const env = {
    ...process.env,
    GITHUB_OUTPUT: outFile,
    GITHUB_STEP_SUMMARY: sumFile,
    INPUT_SITE: SITE,
    INPUT_GRADES: '.provespec/grades.json',
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k}`, String(v)]))
  }
  const res = spawnSync(process.execPath, [join(HERE, 'gate.mjs')], { cwd: dir, env, encoding: 'utf-8' })
  const outputs = existsSync(outFile)
    ? Object.fromEntries(
        readFileSync(outFile, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((l) => l.split('='))
      )
    : {}
  return {
    code: res.status,
    out: res.stdout ?? '',
    err: res.stderr ?? '',
    summary: existsSync(sumFile) ? readFileSync(sumFile, 'utf-8') : '',
    outputs,
    dir
  }
}

/* ── pure rules ───────────────────────────────────────────────────────────── */

test('the floor fails a low score and passes a high one', () => {
  assert.equal(evaluateGate({ current: 70, min: 80 }).exitCode, 1)
  assert.equal(evaluateGate({ current: 90, min: 80 }).exitCode, 0)
})

test('no-regression fails a drop and respects tolerance', () => {
  assert.equal(evaluateGate({ current: 70, previous: 75, noRegression: true }).exitCode, 1)
  assert.equal(evaluateGate({ current: 70, previous: 75, noRegression: true, tolerance: 5 }).exitCode, 0)
})

test('nothing measurable is its own exit code, not a failure', () => {
  const gate = evaluateGate({ current: null, min: 80 })
  assert.equal(gate.exitCode, 2)
  assert.equal(gate.passed, false)
})

test('the badge is self-contained — no external requests', () => {
  const svg = badgeSvg({ label: 'parity', value: '75%', color: parityColor(75) })
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.doesNotMatch(svg, /(href|src)=|url\(\s*['"]?https?:/)
  assert.match(svg, /75%/)
})

test('the color ramp moves with the score', () => {
  assert.notEqual(parityColor(20), parityColor(99))
  assert.equal(parityColor(null), '#9f9f9f')
})

/* ── the step, end to end ─────────────────────────────────────────────────── */

const FULL_AI = [
  ['AI', 'Model', 'Todo item shape'],
  ['AI', 'Model', 'Add todo'],
  ['AI', 'Model', 'Edit todo title'],
  ['AI', 'Model', 'Toggle completed'],
  ['AI', 'Model', 'Toggle all'],
  ['AI', 'Model', 'Delete todo'],
  ['AI', 'Model', 'Clear completed'],
  ['AI', 'Persistence', 'Todos survive reload'],
  ['AI', 'Routing', 'Filter routes']
].map((path) => ({ path, status: 'yes', note: 'src/model.ts' }))

liveTest('a complete implementation passes the floor and reports 100%', () => {
  const r = runGate({ product: 'test-build', grades: FULL_AI }, { SPEC: 'todomvc', SCOPE: 'AI', MIN: '80' })
  assert.equal(r.code, 0, r.err)
  assert.equal(r.outputs.parity, '100')
  assert.equal(r.outputs.ungraded, '0')
  assert.match(r.summary, /✅ passed/)
})

liveTest('an incomplete implementation fails and names what to close', () => {
  const r = runGate({ product: 'test-build', grades: FULL_AI.slice(0, 3) }, { SPEC: 'todomvc', SCOPE: 'AI', MIN: '80' })
  assert.equal(r.code, 1)
  assert.equal(r.outputs.parity, '33')
  assert.equal(r.outputs.ungraded, '6')
  assert.match(r.summary, /❌ failed/)
  assert.match(r.err, /below the required 80%/)
  assert.match(r.err, /Capabilities to close/)
  assert.match(r.err, /AI > Routing > Filter routes/)
})

liveTest('no-regression compares against the parity recorded in the grades file', () => {
  const r = runGate(
    { product: 'test-build', parity: 100, grades: FULL_AI.slice(0, 8) },
    { SPEC: 'todomvc', SCOPE: 'AI', NO_REGRESSION: 'true' }
  )
  assert.equal(r.code, 1)
  assert.match(r.err, /parity dropped 11 points \(100% → 89%\)/)
})

liveTest('the badge lands where asked, with the score in it', () => {
  const r = runGate({ grades: FULL_AI }, { SPEC: 'todomvc', SCOPE: 'AI', BADGE: 'badges/parity.svg' })
  assert.equal(r.code, 0, r.err)
  const svg = readFileSync(join(r.dir, 'badges', 'parity.svg'), 'utf-8')
  assert.match(svg, /100%/)
  assert.match(svg, /parity \(AI\)/)
})

test('a missing grades file explains the format instead of crashing', () => {
  const r = runGate({ grades: FULL_AI }, { SPEC: 'todomvc', GRADES: 'nope.json' })
  assert.equal(r.code, 2)
  assert.match(r.err, /No grades file at "nope\.json"/)
  assert.match(r.err, /"status": "yes"/)
})

liveTest('an unknown scope names the groups the spec actually has', () => {
  const r = runGate({ grades: FULL_AI }, { SPEC: 'todomvc', SCOPE: 'Engine' })
  assert.equal(r.code, 2)
  assert.match(r.err, /Groups in this spec: AI, UI/)
})

liveTest('an unknown spec points at the catalog', () => {
  const r = runGate({ grades: FULL_AI }, { SPEC: 'no-such-spec-here' })
  assert.equal(r.code, 2)
  assert.match(r.err, /HTTP 404/)
  assert.match(r.err, /catalog/)
})

console.log(`${passed} tests passed${skipped ? `, ${skipped} skipped (catalog unreachable)` : ''}`)
