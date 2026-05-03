import type { CoverageRecord, EmployeeRecord, GenderCode, PensionStatusRow } from '../types'

const MONTHS_IN_YEAR = 12

export function analyzePensionStatus(
  employees: EmployeeRecord[],
  coverages: CoverageRecord[],
  reportMonthValue: string,
): PensionStatusRow[] {
  const reportMonth = parseMonthInput(reportMonthValue)
  const coverageByEmployee = groupCoverageByEmployee(coverages)
  const rows: PensionStatusRow[] = []

  for (const employee of employees) {
    if (hasLeftEmployment(employee, reportMonth)) {
      continue
    }

    const employeeCoverages = coverageByEmployee.get(employee.employeeId) ?? []
    rows.push(buildEmployeeStatus(employee, employeeCoverages, reportMonth))
  }

  return rows
}

export function resolveGender(value: string): GenderCode {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'ז' || normalized === 'זכר' || normalized === 'm' || normalized === 'male') {
    return 'male'
  }

  if (normalized === 'נ' || normalized === 'נקבה' || normalized === 'f' || normalized === 'female') {
    return 'female'
  }

  return null
}

export function hasLeftEmployment(employee: EmployeeRecord, reportMonth: Date): boolean {
  if (isActiveStopReason(employee.stopReason)) {
    return false
  }

  if (employee.stopReason && employee.stopReason.trim() !== '') {
    if (!employee.stopDate) {
      return true
    }
    return monthIndex(employee.stopDate) <= monthIndex(reportMonth)
  }

  if (employee.stopDate) {
    return monthIndex(employee.stopDate) <= monthIndex(reportMonth)
  }

  return false
}

// In Michpal exports the "קוד הפסקה" field is set even for active employees,
// with a sentinel like "0-לחשב תלושים" meaning "still on payroll". A leading
// zero (alone or before a dash) signals active employment; any other code is
// a real stoppage reason (4-חופשת לידה, 5-שמירת היריון, 9-עזב, ...).
function isActiveStopReason(stopReason: string): boolean {
  const trimmed = (stopReason ?? '').trim()
  if (!trimmed) return false
  return /^0(\D|$)/.test(trimmed)
}

export function getCurrentMonthInputValue(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

export function formatDate(date: Date | null): string {
  if (!date) {
    return 'לא זמין'
  }

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export function formatMonth(date: Date | null): string {
  if (!date) {
    return 'לא זמין'
  }

  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function describeTimeline(row: PensionStatusRow): string {
  if (row.status === 'יש קופה') {
    return 'תקין'
  }

  if (row.status === 'זכאי החודש') {
    return 'החודש'
  }

  if (row.status === 'חסר נתונים') {
    return '—'
  }

  if (row.status === 'טרם זכאי') {
    return row.monthsRemaining === 1
      ? 'עוד חודש'
      : `${row.monthsRemaining ?? 0} חודשים`
  }

  return row.monthsLate === 1 ? 'חודש אחד' : `${row.monthsLate ?? 0} חודשים`
}

export function compareStatusRows(
  left: PensionStatusRow,
  right: PensionStatusRow,
  sortBy: 'urgency' | 'eligibility' | 'name',
): number {
  if (sortBy === 'name') {
    return left.name.localeCompare(right.name, 'he')
  }

  if (sortBy === 'eligibility') {
    return compareDates(left.eligibilityMonth, right.eligibilityMonth)
  }

  const leftRank = urgencyRank(left)
  const rightRank = urgencyRank(right)

  if (leftRank !== rightRank) {
    return rightRank - leftRank
  }

  if (left.status === 'באיחור' && right.status === 'באיחור') {
    return (right.monthsLate ?? 0) - (left.monthsLate ?? 0)
  }

  if (left.status === 'טרם זכאי' && right.status === 'טרם זכאי') {
    return (left.monthsRemaining ?? Number.MAX_SAFE_INTEGER) - (right.monthsRemaining ?? Number.MAX_SAFE_INTEGER)
  }

  return compareDates(left.eligibilityMonth, right.eligibilityMonth)
}

function buildEmployeeStatus(
  employee: EmployeeRecord,
  coverages: CoverageRecord[],
  reportMonth: Date,
): PensionStatusRow {
  const seventhMonth = employee.startDate ? addMonths(startOfMonth(employee.startDate), 6) : null
  const genderCode = resolveGender(employee.gender)
  const ageEligibilityMonth = getAgeEligibilityMonth(employee.birthDate, genderCode)
  const eligibilityMonth = maxDate(seventhMonth, ageEligibilityMonth)
  const coverage = summarizeCoverage(employee, coverages)
  const base = baseRow(employee, eligibilityMonth, seventhMonth, ageEligibilityMonth, coverage, reportMonth)

  if (coverage.kind !== 'none') {
    return {
      ...base,
      status: 'יש קופה',
      detail: coverage.detail,
      monthsRemaining: null,
      monthsLate: null,
      coverageKind: coverage.kind,
      fundLabels: coverage.fundLabels,
      primaryFund: coverage.primaryFund,
    }
  }

  // Without coverage, missing data prevents reliable classification.
  const missingFields: string[] = []
  if (!employee.startDate) missingFields.push('תחילת עבודה')
  if (!employee.birthDate) missingFields.push('תאריך לידה')
  if (genderCode === null) missingFields.push('מין')

  if (missingFields.length > 0) {
    const detail = `חסרים נתונים: ${missingFields.join(', ')}. לא ניתן לחשב חודש זכאות.`
    return {
      ...base,
      status: 'חסר נתונים',
      detail: coverage.idMismatch ? `${detail} | יש לבדוק אי התאמה במספר הזהות.` : detail,
      monthsRemaining: null,
      monthsLate: null,
    }
  }

  if (!eligibilityMonth) {
    return {
      ...base,
      status: 'חסר נתונים',
      detail: 'לא ניתן לחשב חודש זכאות.',
      monthsRemaining: null,
      monthsLate: null,
    }
  }

  const monthGap = monthIndex(eligibilityMonth) - monthIndex(reportMonth)
  const detail = buildMissingCoverageDetail(
    reportMonth,
    seventhMonth,
    ageEligibilityMonth,
    coverage.idMismatch,
  )

  if (monthGap > 0) {
    return {
      ...base,
      status: 'טרם זכאי',
      detail,
      monthsRemaining: monthGap,
      monthsLate: null,
    }
  }

  if (monthGap === 0) {
    return {
      ...base,
      status: 'זכאי החודש',
      detail: 'הגיע לחודש תחילת ההפרשה ועדיין אין קופה בדוח גמל.',
      monthsRemaining: 0,
      monthsLate: null,
    }
  }

  return {
    ...base,
    status: 'באיחור',
    detail: 'אין קופה בדוח גמל למרות שהעובד כבר אמור להיות מבוטח.',
    monthsRemaining: null,
    monthsLate: Math.abs(monthGap),
  }
}

function baseRow(
  employee: EmployeeRecord,
  eligibilityMonth: Date | null,
  seventhMonth: Date | null,
  ageEligibilityMonth: Date | null,
  coverage: ReturnType<typeof summarizeCoverage>,
  reportMonth: Date,
): PensionStatusRow {
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    firstName: employee.firstName,
    nationalId: employee.nationalId,
    gender: employee.gender,
    email: employee.email,
    age: computeAge(employee.birthDate, reportMonth),
    birthDate: employee.birthDate,
    startDate: employee.startDate,
    eligibilityMonth,
    seventhMonth,
    ageEligibilityMonth,
    status: 'טרם זכאי',
    detail: '',
    monthsRemaining: null,
    monthsLate: null,
    coverageKind: 'none',
    phone: employee.phone,
    department: employee.department,
    city: employee.city,
    address: employee.address,
    fundLabels: [],
    primaryFund: 'ללא קופה',
    hasIdMismatch: coverage.idMismatch,
  }
}

export function computeAge(birthDate: Date | null, asOf: Date): number | null {
  if (!birthDate) return null
  let age = asOf.getFullYear() - birthDate.getFullYear()
  const m = asOf.getMonth() - birthDate.getMonth()
  if (m < 0 || (m === 0 && asOf.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

function summarizeCoverage(
  employee: EmployeeRecord,
  coverages: CoverageRecord[],
): {
  kind: 'pension' | 'foreign_deposit' | 'none'
  detail: string
  fundLabels: string[]
  primaryFund: string
  idMismatch: boolean
} {
  let hasForeignDeposit = false
  const pensionFundNames = new Set<string>()
  const foreignDepositNames = new Set<string>()
  let idMismatch = false

  for (const coverage of coverages) {
    if (employee.nationalId && coverage.nationalId && employee.nationalId !== coverage.nationalId) {
      idMismatch = true
    }

    const fundName = coverage.fundName
    const fundType = coverage.fundType
    if (!fundName && !fundType) {
      continue
    }

    if (isForeignDeposit(fundName, fundType)) {
      hasForeignDeposit = true
      foreignDepositNames.add(fundName || 'פקדון זרים')
      continue
    }

    if (isPensionCoverage(fundName, fundType)) {
      pensionFundNames.add(fundName || fundType)
    }
  }

  if (pensionFundNames.size > 0) {
    const fundLabels = Array.from(pensionFundNames)
    const detail = `קופה פעילה: ${fundLabels.slice(0, 2).join(', ')}`
    return {
      kind: 'pension',
      detail: idMismatch ? `${detail} | יש לבדוק אי התאמה במספר הזהות.` : detail,
      fundLabels,
      primaryFund: fundLabels[0] ?? 'קופת פנסיה',
      idMismatch,
    }
  }

  if (hasForeignDeposit) {
    const fundLabels = Array.from(foreignDepositNames)
    return {
      kind: 'foreign_deposit',
      detail: idMismatch ? 'פקדון זרים | יש לבדוק אי התאמה במספר הזהות.' : 'פקדון זרים',
      fundLabels,
      primaryFund: fundLabels[0] ?? 'פקדון זרים',
      idMismatch,
    }
  }

  return {
    kind: 'none',
    detail: idMismatch ? 'יש לבדוק אי התאמה במספר הזהות.' : '',
    fundLabels: [],
    primaryFund: 'ללא קופה',
    idMismatch,
  }
}

function buildMissingCoverageDetail(
  reportMonth: Date,
  seventhMonth: Date | null,
  ageEligibilityMonth: Date | null,
  idMismatch: boolean,
): string {
  const reasons: string[] = []

  if (seventhMonth && monthIndex(seventhMonth) > monthIndex(reportMonth)) {
    reasons.push('ממתין לחודש 7')
  }

  if (ageEligibilityMonth && monthIndex(ageEligibilityMonth) > monthIndex(reportMonth)) {
    reasons.push('ממתין לגיל זכאות')
  }

  const baseDetail = reasons.length > 0 ? reasons.join(' ו') : 'אין קופה בדוח גמל.'
  return idMismatch ? `${baseDetail} | יש לבדוק אי התאמה במספר הזהות.` : baseDetail
}

function getAgeEligibilityMonth(birthDate: Date | null, gender: GenderCode): Date | null {
  if (!birthDate || gender === null) {
    return null
  }

  const eligibilityAge = gender === 'female' ? 20 : 21
  return new Date(birthDate.getFullYear() + eligibilityAge, birthDate.getMonth(), 1)
}

function groupCoverageByEmployee(coverages: CoverageRecord[]): Map<string, CoverageRecord[]> {
  const map = new Map<string, CoverageRecord[]>()

  for (const coverage of coverages) {
    const existing = map.get(coverage.employeeId)
    if (existing) {
      existing.push(coverage)
      continue
    }

    map.set(coverage.employeeId, [coverage])
  }

  return map
}

function parseMonthInput(value: string): Date {
  const [yearPart, monthPart] = value.split('-')
  const year = Number.parseInt(yearPart ?? '', 10)
  const month = Number.parseInt(monthPart ?? '', 10)

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return startOfMonth(new Date())
  }

  return new Date(year, month - 1, 1)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right
  }

  if (!right) {
    return left
  }

  return left.getTime() >= right.getTime() ? left : right
}

function monthIndex(date: Date): number {
  return date.getFullYear() * MONTHS_IN_YEAR + date.getMonth()
}

function compareDates(left: Date | null, right: Date | null): number {
  if (!left && !right) {
    return 0
  }

  if (!left) {
    return 1
  }

  if (!right) {
    return -1
  }

  return left.getTime() - right.getTime()
}

function urgencyRank(row: PensionStatusRow): number {
  switch (row.status) {
    case 'באיחור':
      return 5
    case 'זכאי החודש':
      return 4
    case 'חסר נתונים':
      return 3
    case 'טרם זכאי':
      return 2
    case 'יש קופה':
      return 1
    default:
      return 0
  }
}

function isPensionCoverage(fundName: string, fundType: string): boolean {
  const normalizedFundName = normalizeForMatch(fundName)
  const normalizedFundType = normalizeForMatch(fundType)

  // Training fund alone (קרן השתלמות) is NOT pension coverage.
  if (normalizedFundType.includes('השתלמות') && !normalizedFundType.includes('פנס')) {
    return false
  }
  // Disability rider (אובדן כושר עבודה) alone is NOT pension.
  if (normalizedFundType.includes('אובדן')) {
    return false
  }

  // Real pension types: לקצבה (annuity), פנסיה (pension), תגמולים (provident contribution),
  // פיצויים (severance reserve — paired with annuity in Israeli funds).
  return (
    normalizedFundType.includes('לקצבה') ||
    normalizedFundType.includes('פנס') ||
    normalizedFundType.includes('תגמולים') ||
    normalizedFundType.includes('פיצויים') ||
    normalizedFundName.includes('פנס')
  )
}

function isForeignDeposit(fundName: string, fundType: string): boolean {
  // Match both spelling variants: פקדון (defective) and פיקדון (plene).
  const normalizedFundName = normalizeForMatch(fundName).replace(/פיקדון/g, 'פקדון')
  const normalizedFundType = normalizeForMatch(fundType).replace(/פיקדון/g, 'פקדון')
  return normalizedFundName.includes('פקדון') || normalizedFundType.includes('פקדון')
}

function normalizeForMatch(value: string): string {
  return value.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}
