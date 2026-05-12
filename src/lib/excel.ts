import type {
  CoverageRecord,
  EmployeeRecord,
  ParsedUploadedFile,
  RestigoWorkforceRecord,
  UploadedFileKind,
} from '../types'

type XlsxModule = typeof import('xlsx')
type XlsxWorkbook = import('xlsx').WorkBook
type XlsxWorksheet = import('xlsx').WorkSheet
type XlsxRuntime = {
  read: XlsxModule['read']
  utils: XlsxModule['utils']
  SSF: {
    parse_date_code: (value: number) => { y: number; m: number; d: number } | null
  }
}

// "נתוני עובד" Michpal export — single combined source for active + personal data.
// Export path: ייצוא > דוחות לאקסל > נתוני עובד > עד קוד הפסקה עבודה - 0
const EMPLOYEE_DATA_REQUIRED_HEADERS: readonly string[] = [
  'מספר עובד',
  'שם פרטי',
  'שם משפחה',
  'מספר זהות',
  'קוד מין',
  'תאריך לידה',
  'תאריך תחילת עבודה',
] as const

// "דוח הרכב שכר וגמל מיכפל" — pension/gemel coverage source.
// Export path: ייצוא > דוחות לאקסל > הרכב שכר וגמל > ללא שינוי במסננים
const GMAL_REQUIRED_HEADERS: readonly string[] = [
  'מספר עובד',
  'מספר זהות',
  'שם הקופה',
  'סוג קופה',
] as const

// "דוח מצבת כח אדם" — Restigo workforce composition (לבדיקת קופות פעילות).
// Export path (Restigo): דוחות > מצבת כח אדם > ייצוא לאקסל.
// Layout quirk: row 0 is a merged title cell, real headers live in row 1.
// Required columns are the linking key (`מספר מיכפל`) plus the pension flag
// columns we filter on.
const RESTIGO_WORKFORCE_REQUIRED_HEADERS: readonly string[] = [
  'שם עובד',
  'מספר מיכפל',
  'תאריך תחילת עבודה',
  'קרן פנסיה',
  'שם קרן פנסיה',
] as const

// Maps `מספר מחלקה` from the Michpal export to human-readable names.
// Source: רשימת מחלקות PDF from Michpal (חברה 010 מאפיית אורן משי).
// Prefix rule: `מ.` → "מפעל:", `ס.` → "סניפים:". Dept 29 stays verbatim.
const DEPARTMENT_NAMES: Readonly<Record<number, string>> = {
  2: 'מפעל: מנגנון מפעל',
  3: "סניפים: ח'",
  4: 'סניפים: נאות',
  5: 'מפעל: מטה חברה',
  6: 'סניפים: ברנע',
  7: 'סניפים: באר שבע',
  9: 'סניפים: אגמים',
  10: 'סניפים: מטה סניפים',
  11: 'סניפים: מרינה',
  12: 'סניפים: ראשון לציון',
  13: 'מפעל: עקיף אחזקה',
  14: 'מפעל: עקיף נהגים',
  16: 'מפעל: מחסנים',
  17: 'סניפים: כיכר היונים',
  19: 'מפעל: משק ובקרה',
  20: 'סניפים: יבנה',
  22: 'מפעל: קו פרנה',
  23: 'מפעל: קו פיתה',
  24: 'מפעל: קו שולחן',
  25: 'מפעל: קו בגט',
  26: 'מפעל: קו אריזה שוק',
  27: 'מפעל: אריזה סניפים',
  28: 'מפעל: ייצור קיטים',
  29: 'QUEEN CANS',
  30: 'סניפים: בית קולינריה',
  31: 'סניפים: כרמי גת',
}

function resolveDepartmentName(rawNumber: string): string {
  if (!rawNumber) return ''
  const n = Number(rawNumber)
  if (Number.isFinite(n) && DEPARTMENT_NAMES[n]) return DEPARTMENT_NAMES[n]
  return `מחלקה ${rawNumber}`
}

type RawSheetRows = unknown[][]

interface DetectionResult {
  kind: UploadedFileKind | 'unknown'
  candidateKind: UploadedFileKind | null
  missingHeaders: string[]
}

interface SheetParse {
  sheetName: string
  rows: RawSheetRows // already shifted past any title row
  headers: string[]
  detection: DetectionResult
  hadTitleRow: boolean
}

export async function parseUploadedFile(file: File): Promise<ParsedUploadedFile[]> {
  const xlsx = await loadXlsx()
  const arrayBuffer = await file.arrayBuffer()
  const workbook = xlsx.read(arrayBuffer, {
    type: 'array',
    dense: true,
  })

  const sheetParses = collectSheetParses(workbook, xlsx)

  if (sheetParses.length === 0) {
    return [emptyParsedFile(file, 'הקובץ ריק או שאין בו גיליון עם נתונים.')]
  }

  const knownByKind = new Map<UploadedFileKind, SheetParse>()
  const unknownSheets: SheetParse[] = []

  for (const sheet of sheetParses) {
    if (sheet.detection.kind === 'unknown') {
      unknownSheets.push(sheet)
      continue
    }
    const existing = knownByKind.get(sheet.detection.kind)
    if (!existing || preferReplacement(sheet, existing)) {
      knownByKind.set(sheet.detection.kind, sheet)
    }
  }

  const results: ParsedUploadedFile[] = []

  for (const [kind, sheet] of knownByKind) {
    const issues: string[] = []
    if (sheetParses.length > 1) {
      issues.push(`מתוך הגיליון "${sheet.sheetName}" בקובץ ${file.name}.`)
    }
    if (sheet.hadTitleRow) {
      issues.push(`דילגנו על שורת כותרת בקובץ — שורת ה-headers זוהתה אוטומטית.`)
    }

    const payload: ParsedUploadedFile = {
      id: `${file.name}-${file.lastModified}-${sheet.sheetName}`,
      fileName: file.name,
      sheetName: sheet.sheetName,
      kind,
      candidateKind: kind,
      rowCount: Math.max(sheet.rows.length - 1, 0),
      headers: sheet.headers,
      missingHeaders: [],
      issues,
      employees: [],
      coverages: [],
      restigoWorkforce: [],
      grossSalaryByEmployee: {},
    }

    if (kind === 'employee_data') {
      payload.employees = parseEmployeeDataRows(sheet.rows, xlsx)
    } else if (kind === 'gmal_report') {
      payload.coverages = parseCoverageRows(sheet.rows)
      payload.grossSalaryByEmployee = computeGrossSalaryByEmployee(sheet.rows)
    } else if (kind === 'restigo_workforce') {
      payload.restigoWorkforce = parseRestigoWorkforceRows(sheet.rows, xlsx)
    }

    results.push(payload)
  }

  if (results.length === 0 && unknownSheets.length > 0) {
    const best = unknownSheets[0]
    const issues: string[] = []
    if (best.detection.candidateKind) {
      issues.push(
        `הקובץ דומה ל-${kindLabel(best.detection.candidateKind)}, אבל חסרות כותרות: ${best.detection.missingHeaders.join(', ')}`,
      )
    } else {
      issues.push('לא הצלחנו לזהות את סוג הקובץ לפי הכותרות בשורה הראשונה.')
    }

    results.push({
      id: `${file.name}-${file.lastModified}-${best.sheetName}`,
      fileName: file.name,
      sheetName: best.sheetName,
      kind: 'unknown',
      candidateKind: best.detection.candidateKind,
      rowCount: Math.max(best.rows.length - 1, 0),
      headers: best.headers,
      missingHeaders: best.detection.missingHeaders,
      issues,
      employees: [],
      coverages: [],
      restigoWorkforce: [],
      grossSalaryByEmployee: {},
    })
  }

  return results
}

function emptyParsedFile(file: File, issue: string): ParsedUploadedFile {
  return {
    id: `${file.name}-${file.lastModified}`,
    fileName: file.name,
    kind: 'unknown',
    candidateKind: null,
    rowCount: 0,
    headers: [],
    missingHeaders: [],
    issues: [issue],
    employees: [],
    coverages: [],
    restigoWorkforce: [],
    grossSalaryByEmployee: {},
  }
}

export function kindLabel(kind: UploadedFileKind): string {
  if (kind === 'employee_data') return 'נתוני עובד'
  if (kind === 'restigo_workforce') return 'דוח מצבת כח אדם (רסטיגו)'
  return 'דוח גמל'
}

export function requiredHeadersFor(kind: UploadedFileKind): readonly string[] {
  if (kind === 'employee_data') return EMPLOYEE_DATA_REQUIRED_HEADERS
  if (kind === 'gmal_report') return GMAL_REQUIRED_HEADERS
  return RESTIGO_WORKFORCE_REQUIRED_HEADERS
}

function collectSheetParses(workbook: XlsxWorkbook, xlsx: XlsxRuntime): SheetParse[] {
  const parses: SheetParse[] = []
  for (const sheetName of workbook.SheetNames) {
    const worksheet: XlsxWorksheet | undefined = workbook.Sheets[sheetName]
    if (!worksheet || !worksheet['!ref']) continue
    const rawRows = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }) as RawSheetRows
    if (rawRows.length === 0) continue

    const { headerIndex, hadTitleRow } = locateHeaderRow(rawRows)
    if (headerIndex < 0) continue

    const rows = rawRows.slice(headerIndex)
    const headerRow = rows[0] ?? []
    const headers = headerRow.map((cell) => normalizeText(cell))
    const detection = detectFileKind(headers)
    parses.push({ sheetName, rows, headers, detection, hadTitleRow })
  }
  return parses
}

// Some Hebrew exports (e.g., Restigo "מצבת כח אדם") put a merged title in
// row 0 with one filled cell and many empties — the actual headers are in
// row 1. Detect that pattern and skip the title.
function locateHeaderRow(rows: RawSheetRows): { headerIndex: number; hadTitleRow: boolean } {
  const first = rows[0] ?? []
  const filledFirst = first.filter((cell) => normalizeText(cell) !== '').length
  // Heuristic: if row 0 has only 1-2 filled cells and row 1 is much fuller,
  // treat row 0 as a title and use row 1 as headers.
  if (filledFirst <= 2 && rows.length > 1) {
    const second = rows[1] ?? []
    const filledSecond = second.filter((cell) => normalizeText(cell) !== '').length
    if (filledSecond >= 5) {
      return { headerIndex: 1, hadTitleRow: true }
    }
  }
  return { headerIndex: 0, hadTitleRow: false }
}

function preferReplacement(candidate: SheetParse, existing: SheetParse): boolean {
  if (candidate.detection.kind !== existing.detection.kind) return false
  return candidate.rows.length > existing.rows.length
}

function detectFileKind(headers: string[]): DetectionResult {
  const employeeMatchCount = countMatchedHeaders(headers, EMPLOYEE_DATA_REQUIRED_HEADERS)
  const gmalMatchCount = countMatchedHeaders(headers, GMAL_REQUIRED_HEADERS)
  const restigoMatchCount = countMatchedHeaders(headers, RESTIGO_WORKFORCE_REQUIRED_HEADERS)
  const hasFullEmployeeMatch = employeeMatchCount === EMPLOYEE_DATA_REQUIRED_HEADERS.length
  const hasFullGmalMatch = gmalMatchCount === GMAL_REQUIRED_HEADERS.length
  const hasFullRestigoMatch = restigoMatchCount === RESTIGO_WORKFORCE_REQUIRED_HEADERS.length

  // Restigo workforce has the unique columns "קרן פנסיה" + "שם קרן פנסיה" —
  // the safest signal that it's not the gmal/employee report.
  if (hasFullRestigoMatch) {
    return {
      kind: 'restigo_workforce',
      candidateKind: 'restigo_workforce',
      missingHeaders: [],
    }
  }

  if (hasFullGmalMatch) {
    return { kind: 'gmal_report', candidateKind: 'gmal_report', missingHeaders: [] }
  }

  if (hasFullEmployeeMatch) {
    return { kind: 'employee_data', candidateKind: 'employee_data', missingHeaders: [] }
  }

  const ranked: Array<{ kind: UploadedFileKind; count: number; required: readonly string[] }> = [
    { kind: 'employee_data', count: employeeMatchCount, required: EMPLOYEE_DATA_REQUIRED_HEADERS },
    { kind: 'gmal_report', count: gmalMatchCount, required: GMAL_REQUIRED_HEADERS },
    {
      kind: 'restigo_workforce',
      count: restigoMatchCount,
      required: RESTIGO_WORKFORCE_REQUIRED_HEADERS,
    },
  ]
  ranked.sort((a, b) => b.count - a.count)
  const best = ranked[0]

  if (best.count === 0) {
    return { kind: 'unknown', candidateKind: null, missingHeaders: [] }
  }

  return {
    kind: 'unknown',
    candidateKind: best.kind,
    missingHeaders: getMissingHeaders(headers, best.required),
  }
}

function parseEmployeeDataRows(rows: RawSheetRows, xlsx: XlsxRuntime): EmployeeRecord[] {
  const headerIndex = createHeaderIndex(rows[0] ?? [])
  const emailIdx = findHeaderIndexByContains(rows[0] ?? [], 'דוא')
  const employees: EmployeeRecord[] = []

  for (const row of rows.slice(1)) {
    const employeeId = normalizeIdentifier(row[headerIndex.get(canonicalizeHeader('מספר עובד')) ?? -1])
    const firstName = normalizeText(row[headerIndex.get(canonicalizeHeader('שם פרטי')) ?? -1])
    const lastName = normalizeText(row[headerIndex.get(canonicalizeHeader('שם משפחה')) ?? -1])
    const name = [firstName, lastName].filter(Boolean).join(' ')

    if (!employeeId || !name) {
      continue
    }

    const street = normalizeText(row[headerIndex.get(canonicalizeHeader('כתובת')) ?? -1])
    const houseNumber = normalizeText(row[headerIndex.get(canonicalizeHeader('כתובת - מספר בית')) ?? -1])
    const city = normalizeText(row[headerIndex.get(canonicalizeHeader('כתובת - ישוב')) ?? -1])
    const departmentNumber = normalizeText(row[headerIndex.get(canonicalizeHeader('מספר מחלקה')) ?? -1])

    employees.push({
      employeeId,
      name,
      firstName,
      nationalId: normalizeIdentifier(row[headerIndex.get(canonicalizeHeader('מספר זהות')) ?? -1]),
      stopDate: parseExcelDate(
        row[headerIndex.get(canonicalizeHeader('תאריך הפסקת עבודה')) ?? -1],
        xlsx,
      ),
      stopReason: normalizeText(row[headerIndex.get(canonicalizeHeader('קוד הפסקת עבודה')) ?? -1]),
      birthDate: parseExcelDate(
        row[headerIndex.get(canonicalizeHeader('תאריך לידה')) ?? -1],
        xlsx,
      ),
      gender: normalizeText(row[headerIndex.get(canonicalizeHeader('קוד מין')) ?? -1]),
      startDate: parseExcelDate(
        row[headerIndex.get(canonicalizeHeader('תאריך תחילת עבודה')) ?? -1],
        xlsx,
      ),
      email: emailIdx >= 0 ? normalizeText(row[emailIdx]) : '',
      phone: normalizePhone(row[headerIndex.get(canonicalizeHeader('טלפון')) ?? -1]),
      department: resolveDepartmentName(departmentNumber),
      city,
      address: [street, houseNumber, city].filter(Boolean).join(' '),
    })
  }

  return employees
}

function parseRestigoWorkforceRows(
  rows: RawSheetRows,
  xlsx: XlsxRuntime,
): RestigoWorkforceRecord[] {
  const headerRow = rows[0] ?? []
  const headerIndex = createHeaderIndex(headerRow)
  const records: RestigoWorkforceRecord[] = []

  const nameIdx =
    headerIndex.get(canonicalizeHeader('שם עובד')) ??
    headerIndex.get(canonicalizeHeader('שם העובד')) ??
    headerIndex.get(canonicalizeHeader('שם מלא'))
  const restigoIdIdx = headerIndex.get(canonicalizeHeader('מספר עובד'))
  const michpalIdIdx =
    headerIndex.get(canonicalizeHeader('מספר מיכפל')) ??
    headerIndex.get(canonicalizeHeader('מספר עובד במערכת שכר'))
  const nationalIdIdx =
    headerIndex.get(canonicalizeHeader('ת.ז / דרכון')) ??
    headerIndex.get(canonicalizeHeader('ת.ז/דרכון'))
  const branchIdx = headerIndex.get(canonicalizeHeader('סניף'))
  const salaryIdx = headerIndex.get(canonicalizeHeader('משכורת'))
  const startDateIdx = headerIndex.get(canonicalizeHeader('תאריך תחילת עבודה'))
  const form101Idx = headerIndex.get(canonicalizeHeader('טופס 101'))
  const fundIndicatorIdx = headerIndex.get(canonicalizeHeader('קרן פנסיה'))
  const fundNameIdx = headerIndex.get(canonicalizeHeader('שם קרן פנסיה'))

  function lookup(row: unknown[], idx: number | undefined): unknown {
    return typeof idx === 'number' ? row[idx] : ''
  }

  for (const row of rows.slice(1)) {
    const restigoId = normalizeIdentifier(lookup(row, restigoIdIdx))
    const name = normalizeText(lookup(row, nameIdx))
    if (!restigoId && !name) continue

    const michpalIdRaw = normalizeIdentifier(lookup(row, michpalIdIdx))
    const michpalId = michpalIdRaw === '0' ? '' : michpalIdRaw

    records.push({
      restigoId,
      michpalId,
      nationalId: normalizeIdentifier(lookup(row, nationalIdIdx)),
      name,
      branch: normalizeText(lookup(row, branchIdx)),
      salary: normalizeText(lookup(row, salaryIdx)),
      startDate: parseExcelDate(lookup(row, startDateIdx), xlsx),
      form101Status: normalizeText(lookup(row, form101Idx)),
      fundIndicator: normalizeText(lookup(row, fundIndicatorIdx)),
      fundName: normalizeText(lookup(row, fundNameIdx)),
    })
  }

  return records
}

function parseCoverageRows(rows: RawSheetRows): CoverageRecord[] {
  const headerIndex = createHeaderIndex(rows[0] ?? [])
  const coverages: CoverageRecord[] = []

  for (const row of rows.slice(1)) {
    const employeeId = normalizeIdentifier(row[headerIndex.get(canonicalizeHeader('מספר עובד')) ?? -1])
    const employeeName = normalizeText(
      row[headerIndex.get(canonicalizeHeader('שם העובד')) ?? -1] ??
        row[headerIndex.get(canonicalizeHeader('שם')) ?? -1],
    )

    if (!employeeId) {
      continue
    }

    const taxYearValue = row[headerIndex.get(canonicalizeHeader('שנת מס')) ?? -1]
    const parsedYear =
      typeof taxYearValue === 'number'
        ? taxYearValue
        : Number.parseInt(normalizeText(taxYearValue), 10)

    coverages.push({
      employeeId,
      employeeName,
      nationalId: normalizeIdentifier(row[headerIndex.get(canonicalizeHeader('מספר זהות')) ?? -1]),
      fundName: normalizeText(row[headerIndex.get(canonicalizeHeader('שם הקופה')) ?? -1]),
      fundType: normalizeText(row[headerIndex.get(canonicalizeHeader('סוג קופה')) ?? -1]),
      taxYear: Number.isNaN(parsedYear) ? null : parsedYear,
    })
  }

  return coverages
}

// Compute gross salary per employee from the gmal "הרכב שכר וגמל" report.
// Each row is one (employee, salary-component, fund) tuple. We sum the cash
// amount (`סכום נדרש`) plus the in-kind value (`שווי נדרש`) on rows where
// `שם רכיב שכר` is filled — those are real salary lines, not pure
// fund-membership rows. Fund-only rows (empty component) are skipped.
export function computeGrossSalaryByEmployee(rows: RawSheetRows): Record<string, number> {
  const headerIndex = createHeaderIndex(rows[0] ?? [])
  const result: Record<string, number> = {}

  const empIdx = headerIndex.get(canonicalizeHeader('מספר עובד'))
  const compIdx = headerIndex.get(canonicalizeHeader('שם רכיב שכר'))
  const sumIdx = headerIndex.get(canonicalizeHeader('סכום נדרש'))
  const valueIdx = headerIndex.get(canonicalizeHeader('שווי נדרש'))
  if (empIdx === undefined || compIdx === undefined) return result

  for (const row of rows.slice(1)) {
    const employeeId = normalizeIdentifier(row[empIdx])
    if (!employeeId) continue
    const component = normalizeText(row[compIdx])
    if (!component) continue
    const cash = sumIdx !== undefined ? toFiniteNumber(row[sumIdx]) : 0
    const inkind = valueIdx !== undefined ? toFiniteNumber(row[valueIdx]) : 0
    const total = cash + inkind
    if (total === 0) continue
    result[employeeId] = (result[employeeId] ?? 0) + total
  }

  return result
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₪,\s]/g, '')
    const parsed = Number.parseFloat(cleaned)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function countMatchedHeaders(
  headers: string[],
  requiredHeaders: readonly string[],
): number {
  const headerSet = new Set(headers.map(canonicalizeHeader))
  return requiredHeaders.filter((header) => headerSet.has(canonicalizeHeader(header))).length
}

function getMissingHeaders(
  headers: string[],
  requiredHeaders: readonly string[],
): string[] {
  const headerSet = new Set(headers.map(canonicalizeHeader))
  return requiredHeaders.filter((header) => !headerSet.has(canonicalizeHeader(header)))
}

function createHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const [cellIndex, value] of headerRow.entries()) {
    const normalized = canonicalizeHeader(normalizeText(value))
    if (normalized) {
      index.set(normalized, cellIndex)
    }
  }
  return index
}

function findHeaderIndexByContains(headerRow: unknown[], needle: string): number {
  for (const [cellIndex, value] of headerRow.entries()) {
    const normalized = normalizeText(value)
    if (normalized.includes(needle)) {
      return cellIndex
    }
  }
  return -1
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '')
  }
  return normalizeText(value)
}

function normalizePhone(value: unknown): string {
  const digitsOnly = normalizeIdentifier(value).replace(/\D+/g, '')
  if (!digitsOnly) {
    return ''
  }
  if (digitsOnly.startsWith('972')) {
    return digitsOnly
  }
  if (digitsOnly.length === 9) {
    return `0${digitsOnly}`
  }
  return digitsOnly
}

function parseExcelDate(value: unknown, xlsx: XlsxRuntime): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null
    }
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  if (typeof value === 'number') {
    const parsed = xlsx.SSF.parse_date_code(value)
    if (!parsed) {
      return null
    }
    return new Date(parsed.y, parsed.m - 1, parsed.d)
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = normalizeText(value)
  if (!trimmed) {
    return null
  }

  const hebrewStyle = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (hebrewStyle) {
    const [, day, month, year] = hebrewStyle
    const normalizedYear = year.length === 2 ? `20${year}` : year
    const parsed = new Date(
      Number.parseInt(normalizedYear, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10),
    )
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const direct = new Date(trimmed)
  if (!Number.isNaN(direct.getTime())) {
    return direct
  }

  return null
}

let xlsxPromise: Promise<XlsxRuntime> | null = null

async function loadXlsx(): Promise<XlsxRuntime> {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx').then((module) => {
      const runtime = ((module as unknown as { default?: unknown }).default ??
        module) as XlsxRuntime
      return runtime
    })
  }
  return xlsxPromise
}

function canonicalizeHeader(value: string): string {
  return value.replace(/[\s"'`´׳״._-]+/gu, '')
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
