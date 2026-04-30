// Smoke test: parse the 3 real input files and report what was detected
// Run: node scripts/smoke-detect.mjs

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')

const files = [
  'דוח ניצולים ונוכחות (1).xlsx',
  'פרטי עובדים.xlsx',
  'קובץ עובדים - מעודכן.xlsx',
]

const ACTIVE = ["מס'", 'מספר זהות/דרכון', 'שם משפחה', 'שם פרטי', 'תאריך לידה', 'תחילת עבודה', 'מספר טלפון']
const DETAILS = ['מספר עובד', 'שם פרטי', 'שם משפחה', 'מספר זהות', 'קוד מין', 'תאריך לידה', 'תאריך תחילת עבודה']
const GMAL = ['מספר עובד', 'מספר זהות', 'שם הקופה', 'סוג קופה1']

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
      employee_list: checkSheet(headers, ACTIVE),
      employee_details: checkSheet(headers, DETAILS),
      gmal_report: checkSheet(headers, GMAL),
    }

    const winner = Object.entries(checks)
      .filter(([, c]) => c.matched === c.total)
      .map(([k]) => k)

    console.log(`  Sheet "${sheetName}" — ${rows.length - 1} rows`)
    console.log(`    employee_list:    ${checks.employee_list.matched}/${checks.employee_list.total}` + (checks.employee_list.missing.length ? `  missing: ${checks.employee_list.missing.join(', ')}` : ''))
    console.log(`    employee_details: ${checks.employee_details.matched}/${checks.employee_details.total}` + (checks.employee_details.missing.length ? `  missing: ${checks.employee_details.missing.join(', ')}` : ''))
    console.log(`    gmal_report:      ${checks.gmal_report.matched}/${checks.gmal_report.total}` + (checks.gmal_report.missing.length ? `  missing: ${checks.gmal_report.missing.join(', ')}` : ''))
    console.log(`    => detected: ${winner.length ? winner.join(', ') : 'unknown'}`)
  }
}
