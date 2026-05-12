import type {
  PensionStatus,
  PensionStatusRow,
  RestigoWorkforceRecord,
} from '../types'
import { describeTimeline, formatDate, formatMonth } from './pension'

interface WorkbookRow {
  [key: string]: string | number | boolean | null
}

export async function exportRowsToWorkbook(
  rows: WorkbookRow[],
  fileName: string,
  sheetName: string,
): Promise<void> {
  const xlsx = await import('xlsx')
  const runtime = (xlsx.default ?? xlsx) as typeof xlsx
  const worksheet = runtime.utils.json_to_sheet(rows)
  const workbook = runtime.utils.book_new()
  runtime.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = runtime.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  })

  await triggerWorkbookDownload(buffer, fileName)
}

const STATUS_TAB_ORDER: PensionStatus[] = [
  'באיחור',
  'זכאי החודש',
  'טרם זכאי',
  'יש קופה',
  'חסר נתונים',
]

const STATUS_TAB_COLORS: Record<PensionStatus, string> = {
  'באיחור': 'FFC54C38',
  'זכאי החודש': 'FFDB7B21',
  'טרם זכאי': 'FFCC981C',
  'יש קופה': 'FF1A8262',
  'חסר נתונים': 'FF6B7280',
}

const STATUS_HEADER_FILL: Record<PensionStatus, string> = {
  'באיחור': 'FFFCE7E2',
  'זכאי החודש': 'FFFFE6C7',
  'טרם זכאי': 'FFFFF1D6',
  'יש קופה': 'FFE5F4ED',
  'חסר נתונים': 'FFEEF1F4',
}

const ACTIVE_FUNDS_TAB_COLOR = 'FF7B5720'
const ACTIVE_FUNDS_HEADER_FILL = 'FFF6E7CF'
const NOTE_FILL = 'FFFFF1D6'
const NOTE_BORDER = 'FFCC981C'

const DEFAULT_SHEET_NOTE = [
  'סוכן יקר, יש לבדוק עם העובדים ולהציע להם קרן פנסיה מתאימה עבורם.',
  'יש לשלוח את הפרטים ל-payroll@orenmeshi.com.',
  'במידה ולא יישלח טופס קופות, נפתח להם קופת ברירת מחדל.',
].join(' ')

const ACTIVE_FUNDS_SHEET_NOTE = [
  'העובדים האלה דיווחו כי קיימת להם קופה פעילה.',
  'נשמח לבדיקה שלכם אם הקופה אכן פעילה ולקבל את הפרטים המלאים כדי להפקיד לשם.',
].join(' ')

interface AgentExportColumn {
  header: string
  width: number
  numFmt?: string
  value: (row: PensionStatusRow) => string | number | Date | null
}

const AGENT_COLUMNS: AgentExportColumn[] = [
  { header: 'מספר עובד', width: 12, value: (row) => row.employeeId },
  { header: 'שם', width: 26, value: (row) => row.name },
  { header: 'מספר זהות', width: 14, value: (row) => row.nationalId },
  { header: 'טלפון', width: 14, value: (row) => row.phone },
  { header: 'דוא"ל', width: 30, value: (row) => row.email },
  { header: 'גיל', width: 7, value: (row) => row.age ?? '' },
  { header: 'תאריך לידה', width: 13, value: (row) => formatDate(row.birthDate) },
  { header: 'מחלקה', width: 22, value: (row) => row.department },
  { header: 'עיר', width: 14, value: (row) => row.city },
  { header: 'כתובת', width: 28, value: (row) => row.address },
  { header: 'קופה', width: 22, value: (row) => row.primaryFund },
  { header: 'סטטוס', width: 14, value: (row) => row.status },
  { header: 'תחילת עבודה', width: 13, value: (row) => formatDate(row.startDate) },
  {
    header: 'חודש תחילת הפרשה',
    width: 18,
    value: (row) => formatMonth(row.eligibilityMonth),
  },
  {
    header: 'חודשים שנותרו / איחור',
    width: 18,
    value: (row) => describeTimeline(row),
  },
  {
    header: 'שכר ברוטו',
    width: 14,
    numFmt: '#,##0 "₪"',
    value: (row) => (row.grossSalary !== null ? row.grossSalary : ''),
  },
  { header: 'פירוט', width: 38, value: (row) => row.detail },
]

interface ActiveFundColumn {
  header: string
  width: number
  numFmt?: string
  value: (entry: RestigoWorkforceRecord) => string | number | null
}

const ACTIVE_FUND_COLUMNS: ActiveFundColumn[] = [
  { header: 'מספר מיכפל', width: 14, value: (e) => e.michpalId || '' },
  { header: 'מספר רסטיגו', width: 14, value: (e) => e.restigoId || '' },
  { header: 'שם', width: 28, value: (e) => e.name },
  { header: 'ת.ז / דרכון', width: 16, value: (e) => e.nationalId || '' },
  { header: 'סניף', width: 14, value: (e) => e.branch || '' },
  { header: 'תאריך תחילת עבודה', width: 16, value: (e) => formatDate(e.startDate) },
  { header: 'שם קרן פנסיה', width: 22, value: (e) => e.fundName },
  { header: 'מצב קרן פנסיה', width: 22, value: (e) => e.fundIndicator || '—' },
  { header: 'משכורת', width: 14, value: (e) => e.salary || '—' },
  { header: 'טופס 101', width: 18, value: (e) => e.form101Status || '—' },
]

export interface AgentExportSummary {
  total: number
  perStatus: Record<PensionStatus, number>
  activeFundsCount: number
  totalGrossSalary: number
  averageGrossSalary: number | null
  uniqueActiveFundNames: string[]
}

export interface AgentExportResult {
  buffer: ArrayBuffer
  summary: AgentExportSummary
}

export async function exportAgentWorkbook(
  rows: PensionStatusRow[],
  activeFundsForReview: RestigoWorkforceRecord[],
  meta: { reportMonth: string; generatedAt: Date },
): Promise<AgentExportResult> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'))
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'בקרת פנסיה'
  workbook.created = meta.generatedAt
  workbook.modified = meta.generatedAt
  workbook.views = [{ rightToLeft: true } as unknown as never]

  const filteredRows = rows.map((row) => row)
  // For "יש קופה" sheet specifically, only include rows with a real fund name.
  const coveredRowsFiltered = filteredRows.filter(
    (row) =>
      row.status === 'יש קופה' &&
      row.primaryFund &&
      row.primaryFund.trim() !== '' &&
      row.primaryFund.trim() !== 'ללא קופה',
  )

  const summary: AgentExportSummary = {
    total: filteredRows.length,
    perStatus: {
      'באיחור': 0,
      'זכאי החודש': 0,
      'טרם זכאי': 0,
      'יש קופה': 0,
      'חסר נתונים': 0,
    },
    activeFundsCount: activeFundsForReview.length,
    totalGrossSalary: 0,
    averageGrossSalary: null,
    uniqueActiveFundNames: Array.from(
      new Set(activeFundsForReview.map((e) => e.fundName).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'he')),
  }
  for (const row of filteredRows) {
    if (row.status === 'יש קופה') {
      // For the summary count we use the same "real text" filter as the sheet.
      if (
        row.primaryFund &&
        row.primaryFund.trim() !== '' &&
        row.primaryFund.trim() !== 'ללא קופה'
      ) {
        summary.perStatus[row.status]++
      }
    } else {
      summary.perStatus[row.status] = (summary.perStatus[row.status] ?? 0) + 1
    }
  }
  let salarySum = 0
  let salaryCount = 0
  for (const row of filteredRows) {
    if (row.grossSalary !== null) {
      salarySum += row.grossSalary
      salaryCount++
    }
  }
  summary.totalGrossSalary = salarySum
  summary.averageGrossSalary = salaryCount > 0 ? salarySum / salaryCount : null

  buildSummarySheet(workbook, meta, summary)
  buildAllSheet(workbook, filteredRows)

  for (const status of STATUS_TAB_ORDER) {
    const statusRows =
      status === 'יש קופה'
        ? coveredRowsFiltered
        : filteredRows.filter((row) => row.status === status)
    if (statusRows.length === 0) continue
    buildStatusSheet(workbook, status, statusRows)
  }

  if (activeFundsForReview.length > 0) {
    buildActiveFundsSheet(workbook, activeFundsForReview)
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
  return { buffer, summary }
}

function buildSummarySheet(
  workbook: import('exceljs').Workbook,
  meta: { reportMonth: string; generatedAt: Date },
  summary: AgentExportSummary,
) {
  const sheet = workbook.addWorksheet('סיכום', {
    views: [{ rightToLeft: true, showGridLines: false }],
    properties: { tabColor: { argb: 'FF14212B' } },
  })

  sheet.mergeCells('A1:D1')
  const titleCell = sheet.getCell('A1')
  titleCell.value = `דוח סוכן פנסיה — חודש ${meta.reportMonth}`
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14212B' } }
  sheet.getRow(1).height = 36

  sheet.getCell('A3').value = 'הופק בתאריך:'
  sheet.getCell('B3').value = formatDate(meta.generatedAt)
  sheet.getCell('A4').value = 'סה״כ עובדים בדוח:'
  sheet.getCell('B4').value = summary.total
  sheet.getCell('A5').value = 'לבדיקת קופות פעילות (רסטיגו):'
  sheet.getCell('B5').value = summary.activeFundsCount

  for (const cellRef of ['A3', 'A4', 'A5']) {
    const cell = sheet.getCell(cellRef)
    cell.font = { bold: true, color: { argb: 'FF14212B' } }
    cell.alignment = { horizontal: 'right', readingOrder: 'rtl' }
  }
  for (const cellRef of ['B3', 'B4', 'B5']) {
    sheet.getCell(cellRef).alignment = { horizontal: 'right', readingOrder: 'rtl' }
  }

  sheet.getRow(7).values = ['סטטוס', 'מספר עובדים']
  styleHeaderRow(sheet.getRow(7), 'FFE2E8F0', 'FF14212B')

  let rowIndex = 8
  for (const status of STATUS_TAB_ORDER) {
    const count = summary.perStatus[status] ?? 0
    sheet.getCell(`A${rowIndex}`).value = status
    sheet.getCell(`B${rowIndex}`).value = count
    sheet.getCell(`A${rowIndex}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_HEADER_FILL[status] },
    }
    sheet.getCell(`A${rowIndex}`).font = { bold: true, color: { argb: STATUS_TAB_COLORS[status] } }
    sheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'right', readingOrder: 'rtl' }
    sheet.getCell(`B${rowIndex}`).alignment = { horizontal: 'right' }
    sheet.getCell(`A${rowIndex}`).border = THIN_BORDER
    sheet.getCell(`B${rowIndex}`).border = THIN_BORDER
    rowIndex++
  }

  // Salary block
  rowIndex++
  sheet.getCell(`A${rowIndex}`).value = 'סה״כ שכר ברוטו (סכום):'
  sheet.getCell(`B${rowIndex}`).value = summary.totalGrossSalary
  sheet.getCell(`B${rowIndex}`).numFmt = '#,##0 "₪"'
  styleStatLine(sheet.getCell(`A${rowIndex}`), sheet.getCell(`B${rowIndex}`))
  rowIndex++
  sheet.getCell(`A${rowIndex}`).value = 'שכר ברוטו ממוצע:'
  sheet.getCell(`B${rowIndex}`).value =
    summary.averageGrossSalary !== null ? Math.round(summary.averageGrossSalary) : '—'
  sheet.getCell(`B${rowIndex}`).numFmt = '#,##0 "₪"'
  styleStatLine(sheet.getCell(`A${rowIndex}`), sheet.getCell(`B${rowIndex}`))

  // Active fund names list
  if (summary.uniqueActiveFundNames.length > 0) {
    rowIndex += 2
    sheet.getCell(`A${rowIndex}`).value = 'קופות שדווחו כפעילות (רסטיגו):'
    sheet.getCell(`A${rowIndex}`).font = { bold: true, color: { argb: 'FF14212B' } }
    sheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'right', readingOrder: 'rtl' }
    rowIndex++
    sheet.mergeCells(`A${rowIndex}:D${rowIndex}`)
    sheet.getCell(`A${rowIndex}`).value = summary.uniqueActiveFundNames.join(' · ')
    sheet.getCell(`A${rowIndex}`).alignment = {
      horizontal: 'right',
      readingOrder: 'rtl',
      wrapText: true,
    }
    sheet.getRow(rowIndex).height = 28
  }

  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 18
  sheet.getColumn(3).width = 12
  sheet.getColumn(4).width = 12
}

function styleStatLine(label: import('exceljs').Cell, value: import('exceljs').Cell) {
  label.font = { bold: true, color: { argb: 'FF14212B' } }
  label.alignment = { horizontal: 'right', readingOrder: 'rtl' }
  value.alignment = { horizontal: 'right' }
  label.border = THIN_BORDER
  value.border = THIN_BORDER
}

function buildAllSheet(workbook: import('exceljs').Workbook, rows: PensionStatusRow[]) {
  const sheet = workbook.addWorksheet('כל העובדים', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 2, showGridLines: false }],
    properties: { tabColor: { argb: 'FF204F7B' } },
  })

  prependSheetNote(sheet, DEFAULT_SHEET_NOTE, AGENT_COLUMNS.length)
  applyAgentColumnsHeaderRow(sheet, 'FF204F7B', 'FFFFFFFF')

  for (const row of rows) {
    appendAgentRow(sheet, row, row.status)
  }

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: AGENT_COLUMNS.length },
  }
}

function buildStatusSheet(
  workbook: import('exceljs').Workbook,
  status: PensionStatus,
  rows: PensionStatusRow[],
) {
  const sheet = workbook.addWorksheet(status, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 2, showGridLines: false }],
    properties: { tabColor: { argb: STATUS_TAB_COLORS[status] } },
  })

  prependSheetNote(sheet, DEFAULT_SHEET_NOTE, AGENT_COLUMNS.length)
  applyAgentColumnsHeaderRow(sheet, STATUS_TAB_COLORS[status], 'FFFFFFFF')

  for (const row of rows) {
    appendAgentRow(sheet, row, status)
  }

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: AGENT_COLUMNS.length },
  }
}

function buildActiveFundsSheet(
  workbook: import('exceljs').Workbook,
  records: RestigoWorkforceRecord[],
) {
  const sheet = workbook.addWorksheet('בדיקת קופות פעילות', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 2, showGridLines: false }],
    properties: { tabColor: { argb: ACTIVE_FUNDS_TAB_COLOR } },
  })

  prependSheetNote(sheet, ACTIVE_FUNDS_SHEET_NOTE, ACTIVE_FUND_COLUMNS.length)
  applyActiveFundsHeaderRow(sheet)

  let rowNumber = 3
  for (const entry of records) {
    const values = ACTIVE_FUND_COLUMNS.map((column) => column.value(entry))
    const added = sheet.insertRow(rowNumber, values)
    paintActiveFundsRow(added)
    rowNumber++
  }

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: ACTIVE_FUND_COLUMNS.length },
  }
}

// Insert a merged note row at row 1 spanning the data columns. Headers move
// to row 2; freeze pane and autoFilter callers must reference row 2.
function prependSheetNote(
  sheet: import('exceljs').Worksheet,
  text: string,
  columnCount: number,
) {
  const lastColLetter = columnLetter(columnCount)
  sheet.mergeCells(`A1:${lastColLetter}1`)
  const noteCell = sheet.getCell('A1')
  noteCell.value = text
  noteCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF7B5720' } }
  noteCell.alignment = {
    vertical: 'middle',
    horizontal: 'right',
    readingOrder: 'rtl',
    wrapText: true,
  }
  noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NOTE_FILL } }
  noteCell.border = {
    top: { style: 'medium', color: { argb: NOTE_BORDER } },
    bottom: { style: 'medium', color: { argb: NOTE_BORDER } },
    left: { style: 'medium', color: { argb: NOTE_BORDER } },
    right: { style: 'medium', color: { argb: NOTE_BORDER } },
  } as unknown as import('exceljs').Borders
  sheet.getRow(1).height = 48
}

function applyAgentColumnsHeaderRow(
  sheet: import('exceljs').Worksheet,
  fillArgb: string,
  textArgb: string,
) {
  // Set widths and header row 2 values manually since we already used row 1
  // for the note. exceljs `columns` would overwrite row 1 if we used it here.
  AGENT_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width
    if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt
  })
  const headerRow = sheet.getRow(2)
  headerRow.values = AGENT_COLUMNS.map((column) => column.header)
  styleHeaderRow(headerRow, fillArgb, textArgb)
}

function applyActiveFundsHeaderRow(sheet: import('exceljs').Worksheet) {
  ACTIVE_FUND_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width
    if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt
  })
  const headerRow = sheet.getRow(2)
  headerRow.values = ACTIVE_FUND_COLUMNS.map((column) => column.header)
  styleHeaderRow(headerRow, ACTIVE_FUNDS_TAB_COLOR, 'FFFFFFFF')
}

function appendAgentRow(
  sheet: import('exceljs').Worksheet,
  row: PensionStatusRow,
  status: PensionStatus,
) {
  const values = AGENT_COLUMNS.map((column) => column.value(row))
  const added = sheet.addRow(values)
  paintStatusRow(added, status)
}

function styleHeaderRow(
  row: import('exceljs').Row,
  fillArgb: string,
  textArgb: string,
) {
  row.height = 26
  row.font = { name: 'Calibri', size: 12, bold: true, color: { argb: textArgb } }
  row.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    readingOrder: 'rtl',
    wrapText: true,
  }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  row.eachCell((cell) => {
    cell.border = THIN_BORDER
  })
}

function paintStatusRow(row: import('exceljs').Row, status: PensionStatus) {
  const stripe = row.number % 2 === 0 ? 'FFFFFFFF' : 'FFF7F9FB'
  row.alignment = { vertical: 'middle', horizontal: 'right', readingOrder: 'rtl', wrapText: true }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripe } }
    cell.border = THIN_BORDER
  })
  // Status column is index 12 in AGENT_COLUMNS (1-based) — the same in every status sheet.
  const statusCell = row.getCell(12)
  statusCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: STATUS_HEADER_FILL[status] },
  }
  statusCell.font = { bold: true, color: { argb: STATUS_TAB_COLORS[status] } }
}

function paintActiveFundsRow(row: import('exceljs').Row) {
  const stripe = row.number % 2 === 0 ? 'FFFFFFFF' : 'FFFAF6F0'
  row.alignment = { vertical: 'middle', horizontal: 'right', readingOrder: 'rtl', wrapText: true }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripe } }
    cell.border = THIN_BORDER
  })
  // Highlight the fund-name column (index 7) so the agent's eye lands on it.
  const fundCell = row.getCell(7)
  fundCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: ACTIVE_FUNDS_HEADER_FILL },
  }
  fundCell.font = { bold: true, color: { argb: ACTIVE_FUNDS_TAB_COLOR } }
}

const THIN_BORDER: import('exceljs').Borders = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
} as unknown as import('exceljs').Borders

function columnLetter(index: number): string {
  // 1 → "A", 26 → "Z", 27 → "AA". Sufficient for our small column counts.
  let result = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

export async function triggerWorkbookDownload(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<void> {
  let blobPart: BlobPart
  if (buffer instanceof ArrayBuffer) {
    blobPart = buffer
  } else if (ArrayBuffer.isView(buffer)) {
    const view = buffer as ArrayBufferView
    blobPart = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    ) as ArrayBuffer
  } else {
    blobPart = buffer as unknown as BlobPart
  }
  const blob = new Blob([blobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}
