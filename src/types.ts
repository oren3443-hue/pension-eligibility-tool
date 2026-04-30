export type UploadedFileKind = 'employee_list' | 'employee_details' | 'gmal_report'

export type PensionStatus =
  | 'יש קופה'
  | 'טרם זכאי'
  | 'זכאי החודש'
  | 'באיחור / חסר קופה'
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
  sourceVariant: 'active'
}

export interface CoverageRecord {
  employeeId: string
  employeeName: string
  nationalId: string
  fundName: string
  fundType: string
  taxYear: number | null
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
}

export interface MergedEmployeeRecord extends EmployeeRecord {
  detailsFound: boolean
}

export interface PensionStatusRow {
  employeeId: string
  name: string
  firstName: string
  nationalId: string
  gender: string
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
}
