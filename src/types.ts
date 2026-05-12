export type UploadedFileKind = 'employee_data' | 'gmal_report' | 'restigo_workforce'

export type PensionStatus =
  | 'יש קופה'
  | 'טרם זכאי'
  | 'זכאי החודש'
  | 'באיחור'
  | 'חסר נתונים'

export type GenderCode = 'male' | 'female' | null

export interface EmployeeRecord {
  employeeId: string
  name: string
  firstName: string
  nationalId: string
  startDate: Date | null
  birthDate: Date | null
  stopDate: Date | null
  stopReason: string
  gender: string
  email: string
  phone: string
  department: string
  city: string
  address: string
}

export interface CoverageRecord {
  employeeId: string
  employeeName: string
  nationalId: string
  fundName: string
  fundType: string
  taxYear: number | null
}

// Restigo "דוח מצבת כח אדם" — workforce composition with active-fund flag.
// Source columns: שם עובד, מספר עובד, מספר מיכפל, ת.ז / דרכון, סניף, משכורת,
// טופס 101, תאריך תחילת עבודה, קרן פנסיה, שם קרן פנסיה, פרטי בנק.
export interface RestigoWorkforceRecord {
  restigoId: string
  michpalId: string
  nationalId: string
  name: string
  branch: string
  salary: string
  startDate: Date | null
  form101Status: string
  fundIndicator: string // "קיימת קרן פנסיה" / "לא קיימת קרן פנסיה"
  fundName: string // Empty when no fund reported.
}

export interface ParsedUploadedFile {
  id: string
  fileName: string
  sheetName?: string
  kind: UploadedFileKind | 'unknown'
  candidateKind: UploadedFileKind | null
  rowCount: number
  headers: string[]
  missingHeaders: string[]
  issues: string[]
  employees: EmployeeRecord[]
  coverages: CoverageRecord[]
  restigoWorkforce: RestigoWorkforceRecord[]
  // Only populated for gmal_report files: employeeId → gross salary in NIS
  // (sum of סכום נדרש + שווי נדרש across all rows where שם רכיב שכר is set).
  grossSalaryByEmployee: Record<string, number>
}

export interface PensionStatusRow {
  employeeId: string
  name: string
  firstName: string
  nationalId: string
  gender: string
  email: string
  age: number | null
  birthDate: Date | null
  startDate: Date | null
  eligibilityMonth: Date | null
  seventhMonth: Date | null
  ageEligibilityMonth: Date | null
  status: PensionStatus
  detail: string
  monthsRemaining: number | null
  monthsLate: number | null
  coverageKind: 'pension' | 'foreign_deposit' | 'none'
  phone: string
  department: string
  city: string
  address: string
  fundLabels: string[]
  primaryFund: string
  hasIdMismatch: boolean
  grossSalary: number | null
}
