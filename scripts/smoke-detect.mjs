// Smoke test: parse the 2 real input files and report what was detected
// Run: node scripts/smoke-detect.mjs

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')

const files = ['נתוני עובד.xlsx', 'דוח הרכב שכר וגמל מיכפל.xlsx']

const EMPLOYEE = ['מספר עובד', 'שם פרטי', 'שם משפחה', 'מספר זהות', 'קוד מין', 'תאריך לידה', 'תאריך תחילת עבודה']
const GMAL = ['מספר עובד', 'מספר זהות', 'שם הקופה', 'סוג קופה']

function canonicalize(s) {
  return String(s ?? '').replace(/[\s"'`´׳״._-]+/gu, '')
}

function checkSheet(headers, required) {
  const set = new Set(headers.map(canonicalize))
  const matched = required.filter((h) => set.has(canonicalize(h)))
  const missing = required.filter((h) => !set.has(canonicalize(h)))
  return { matched: matched.length, total: required.length, missing }
}

for (const fileName of files) {
  console.log(`\n=== ${fileName} ===`)
  const buf = await readFile(join(dataDir, fileName))
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws['!ref']) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false })
    if (rows.length === 0) continue
    const headers = (rows[0] || []).map((h) => String(h ?? '').trim())

    const checks = {
      employee_data: checkSheet(headers, EMPLOYEE),
      gmal_report: checkSheet(headers, GMAL),
    }

    const winner = Object.entries(checks)
      .filter(([, c]) => c.matched === c.total)
      .map(([k]) => k)

    console.log(`  Sheet "${sheetName}" — ${rows.length - 1} rows`)
    console.log(`    employee_data: ${checks.employee_data.matched}/${checks.employee_data.total}` + (checks.employee_data.missing.length ? `  missing: ${checks.employee_data.missing.join(', ')}` : ''))
    console.log(`    gmal_report:   ${checks.gmal_report.matched}/${checks.gmal_report.total}` + (checks.gmal_report.missing.length ? `  missing: ${checks.gmal_report.missing.join(', ')}` : ''))
    console.log(`    => detected: ${winner.length ? winner.join(', ') : 'unknown'}`)
  }
}
