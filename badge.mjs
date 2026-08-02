// Flat SVG badge, shields-style and self-contained (no external fonts, images
// or requests) so it can be committed straight into a repository.
// Port of src/shared/badge.ts from the ProveSpec app — one behaviour everywhere.

const CHAR_WIDTH = 6.4
const PADDING = 10

/** Color ramp for a parity percentage — red → amber → green. */
export function parityColor(pct) {
  if (pct === null || pct === undefined) return '#9f9f9f'
  if (pct >= 95) return '#2f9e63'
  if (pct >= 80) return '#7cae2f'
  if (pct >= 60) return '#c8a02c'
  if (pct >= 40) return '#d97a25'
  return '#c8452f'
}

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function badgeSvg({ label, value, color = '#4c9aa8' }) {
  const labelWidth = Math.round(label.length * CHAR_WIDTH + PADDING * 2)
  const valueWidth = Math.round(value.length * CHAR_WIDTH + PADDING * 2)
  const total = labelWidth + valueWidth
  const l = escapeXml(label)
  const v = escapeXml(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${l}: ${v}">
  <title>${l}: ${v}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-opacity=".3"/>
    <stop offset="1" stop-opacity=".5"/>
  </linearGradient>
  <rect rx="3" width="${total}" height="20" fill="#555"/>
  <rect rx="3" x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
  <rect rx="3" width="${total}" height="20" fill="url(#s)"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text>
    <text x="${labelWidth / 2}" y="14">${l}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${v}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${v}</text>
  </g>
</svg>
`
}
