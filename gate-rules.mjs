// CI gate semantics — port of evaluateGate from src/shared/badge.ts so the
// Action, the CLI and the app agree on what "passing" means.
//
// Two independent checks: an absolute floor and a no-regression rule. Both must
// hold when requested. Exit codes: 0 pass · 1 gate failure · 2 not measurable.

export function evaluateGate({ current, previous = null, min = null, noRegression = false, tolerance = 0 }) {
  const delta = current !== null && previous !== null ? current - previous : null
  const reasons = []

  if (current === null) {
    return { passed: false, exitCode: 2, reasons: ['no comparable capabilities in scope'], delta }
  }
  if (min !== null && current < min) {
    reasons.push(`parity ${current}% is below the required ${min}%`)
  }
  if (noRegression && delta !== null && delta < -tolerance) {
    reasons.push(
      `parity dropped ${Math.abs(delta)} points (${previous}% → ${current}%)` +
        (tolerance > 0 ? `, tolerance ${tolerance}` : '')
    )
  }
  return { passed: reasons.length === 0, exitCode: reasons.length === 0 ? 0 : 1, reasons, delta }
}
