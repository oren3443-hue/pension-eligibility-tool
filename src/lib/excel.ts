import type {
  CoverageRecord,
  EmployeeRecord,
  ParsedUploadedFile,
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

type RawSheetRows = unknown[][]

interface DetectionResult {
  kind: UploadedFileKind | 'unknown'
  candidateKind: UploadedFileKind | null
  missingHeaders: string[]
}

interface SheetParse {
  sheetName: string
  rows: RawSheetRows
  headers: string[]
  detection: DetectionResult
}

export async function parseUploadedFile(file: File): Promise<ParsedUploadedFile[]> {
  const xlsx = await loadXlsx()
  const arrayBuffer = await file.arrayBuffer()
  const workbook = xlsx.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    dense: true,
  })

  const sheetParses = collectSheetParses(workbook, xlsx)

  if (sheetParses.length === 0) {
    return [
      {
        id: `${file.name}-${file.lastModified}`,
        fileName: file.name,
        kind: 'unknown',
        candidateKind: null,
        rowCount: 0,
        headers: [],
        missingHeaders: [],
        issues: ['הקובץ ריק או שאין בו גיליון עם נתונים.'],
        employees: [],
        coverages: [],
      },
    ]
  }

  const knownByKind = new Map<UploadedFileKind, SheetParse>()
  const unknownSheets: SheetParse[] = []

  for (const sheet of sheetParses) {
    if (sheet.detection.kind === 'unknown') {
      unknownSheets.push(sheet)
      continue
    }
    if (!knownByKind.has(sheet.detection.kind)) {
      knownByKind.set(sheet.detection.kind, sheet)
    }
  }

  const results: ParsedUploadedFile[] = []

  for (const [kind, sheet] of knownByKind) {
    const issues: string[] = []
    if (sheetParses.length > 1) {
      issues.push(`מתוך הגיליון "${sheet.sheetName}" בקובץ ${file.name}.`)
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
    }

    if (kind === 'employee_data') {
      payload.employees = parseEmployeeDataRows(sheet.rows, xlsx)
    } else if (kind === 'gmal_report') {
      payload.coverages = parseCoverageRows(sheet.rows)
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
    })
  }

  return results
}

export function kindLabel(kind: UploadedFileKind): string {
  if (kind === 'employee_data') {
    return 'נתוני עובד'
  }
  return 'דוח גמל'
}

function collectSheetParses(workbook: XlsxWorkbook, xlsx: XlsxRuntime): SheetParse[] {
  const parses: SheetParse[] = []
  for (const sheetName of workbook.SheetNames) {
    const worksheet: XlsxWorksheet | undefined = workbook.Sheets[sheetName]
    if (!worksheet || !worksheet['!ref']) continue
    const rows = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }) as RawSheetRows
    if (rows.length === 0) continue
    const [headerRow = []] = rows
    const headers = headerRow.map((cell) => normalizeText(cell))
    const detection = detectFileKind(headers)
    parses.push({ sheetName, rows, headers, detection })
  }
  return parses
}

function detectFileKind(headers: string[]): DetectionResult {
  const employeeMatchCount = countMatchedHeaders(headers, EMPLOYEE_DATA_REQUIRED_HEADERS)
  const gmalMatchCount = countMatchedHeaders(headers, GMAL_REQUIRED_HEADERS)
  const hasFullEmployeeMatch = employeeMatchCount === EMPLOYEE_DATA_REQUIRED_HEADERS.length
  const hasFullGmalMatch = gmalMatchCount === GMAL_REQUIRED_HEADERS.length

  // The gmal report includes "מספר עובד" + "מספר זהות" too — distinguishing column is "שם הקופה" / "סוג קופה".
  if (hasFullGmalMatch) {
    return { kind: 'gmal_report', candidateKind: 'gmal_report', missingHeaders: [] }
  }

  if (hasFullEmployeeMatch) {
    return { kind: 'employee_data', candidateKind: 'employee_data', missingHeaders: [] }
  }

  const ranked: Array<{ kind: UploadedFileKind; count: number; required: readonly string[] }> = [
    { kind: 'employee_data', count: employeeMatchCount, required: EMPLOYEE_DATA_REQUIRED_HEADERS },
    { kind: 'gmal_report', count: gmalMatchCount, required: GMAL_REQUIRED_HEADERS },
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
      department: departmentNumber ? `מחלקה ${departmentNumber}` : '',
      city,
      address: [street, houseNumber, city].filter(Boolean).join(' '),
    })
  }

  return employees
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
