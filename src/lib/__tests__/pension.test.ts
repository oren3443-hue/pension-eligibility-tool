import { describe, it, expect } from 'vitest'
import { analyzePensionStatus, hasLeftEmployment, resolveGender } from '../pension'
import type { CoverageRecord, EmployeeRecord } from '../../types'

function makeEmployee(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    employeeId: 'E1',
    name: 'דוגמה דוגמה',
    firstName: 'דוגמה',
    nationalId: '123456789',
    startDate: new Date(2025, 0, 15),
    birthDate: new Date(2000, 5, 1),
    stopDate: null,
    stopReason: '',
    gender: 'נ',
    email: '',
    phone: '0501234567',
    department: '',
    city: '',
    address: '',
    ...overrides,
  }
}

describe('resolveGender', () => {
  it('maps Hebrew letters', () => {
    expect(resolveGender('ז')).toBe('male')
    expect(resolveGender('נ')).toBe('female')
  })

  it('maps full Hebrew words', () => {
    expect(resolveGender('זכר')).toBe('male')
    expect(resolveGender('נקבה')).toBe('female')
  })

  it('maps English aliases', () => {
    expect(resolveGender('M')).toBe('male')
    expect(resolveGender('female')).toBe('female')
  })

  it('returns null for unknown', () => {
    expect(resolveGender('')).toBeNull()
    expect(resolveGender('?')).toBeNull()
    expect(resolveGender('other')).toBeNull()
  })
})

describe('hasLeftEmployment', () => {
  it('returns true when stopReason set and no date', () => {
    const employee = makeEmployee({ stopReason: '01' })
    expect(hasLeftEmployment(employee, new Date(2026, 3, 1))).toBe(true)
  })

  it('returns true when stopDate is before reportMonth', () => {
    const employee = makeEmployee({ stopDate: new Date(2026, 1, 15) })
    expect(hasLeftEmployment(employee, new Date(2026, 3, 1))).toBe(true)
  })

  it('returns false when stopDate is after reportMonth', () => {
    const employee = makeEmployee({ stopDate: new Date(2026, 6, 15) })
    expect(hasLeftEmployment(employee, new Date(2026, 3, 1))).toBe(false)
  })

  it('returns false when no stop info', () => {
    const employee = makeEmployee()
    expect(hasLeftEmployment(employee, new Date(2026, 3, 1))).toBe(false)
  })
})

describe('analyzePensionStatus — month 7 rule', () => {
  it('marks employee due this month at month 7 (start month + 6)', () => {
    // Started Jan 2025; month 7 = Jul 2025; report = Jul 2025 → due now
    const employee = makeEmployee({
      startDate: new Date(2025, 0, 1),
      birthDate: new Date(1990, 0, 1), // age eligibility long since passed
      gender: 'נ',
    })
    const rows = analyzePensionStatus([employee], [], '2025-07')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('זכאי החודש')
    expect(rows[0].seventhMonth?.getMonth()).toBe(6) // July (0-indexed)
  })

  it('marks employee not yet eligible before month 7', () => {
    const employee = makeEmployee({
      startDate: new Date(2025, 0, 1), // Jan 2025
      birthDate: new Date(1990, 0, 1),
      gender: 'נ',
    })
    const rows = analyzePensionStatus([employee], [], '2025-04') // before Jul
    expect(rows[0].status).toBe('טרם זכאי')
    expect(rows[0].monthsRemaining).toBe(3)
  })

  it('marks employee late after month 7 with no coverage', () => {
    const employee = makeEmployee({
      startDate: new Date(2024, 0, 1), // Jan 2024
      birthDate: new Date(1990, 0, 1),
      gender: 'נ',
    })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    expect(rows[0].status).toBe('באיחור')
    expect(rows[0].monthsLate).toBeGreaterThan(0)
  })
})

describe('analyzePensionStatus — age eligibility rule', () => {
  it('female age 20 is the eligibility month', () => {
    // Female born June 2006 → eligible June 2026
    const employee = makeEmployee({
      startDate: new Date(2026, 0, 1), // started Jan 2026, month 7 = Jul 2026
      birthDate: new Date(2006, 5, 1),
      gender: 'נ',
    })
    const rows = analyzePensionStatus([employee], [], '2026-07')
    // Eligibility = max(Jul 2026, Jun 2026) = Jul 2026 → due in Jul
    expect(rows[0].status).toBe('זכאי החודש')
    expect(rows[0].ageEligibilityMonth?.getFullYear()).toBe(2026)
    expect(rows[0].ageEligibilityMonth?.getMonth()).toBe(5) // June
  })

  it('male age 21 (later than female)', () => {
    const employee = makeEmployee({
      startDate: new Date(2025, 0, 1),
      birthDate: new Date(2007, 0, 1),
      gender: 'ז',
    })
    const rows = analyzePensionStatus([employee], [], '2025-07')
    expect(rows[0].ageEligibilityMonth?.getFullYear()).toBe(2028)
  })

  it('age dominates when later than month 7', () => {
    const employee = makeEmployee({
      startDate: new Date(2024, 0, 1), // month 7 = Jul 2024
      birthDate: new Date(2008, 0, 1), // male age 21 = Jan 2029
      gender: 'ז',
    })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    // Eligibility = max(Jul 2024, Jan 2029) = Jan 2029 → not yet
    expect(rows[0].status).toBe('טרם זכאי')
    expect(rows[0].eligibilityMonth?.getFullYear()).toBe(2029)
  })
})

describe('analyzePensionStatus — left employment', () => {
  it('excludes employees with stopReason from results', () => {
    const employees = [
      makeEmployee({ employeeId: 'A', stopReason: '01' }),
      makeEmployee({ employeeId: 'B' }),
    ]
    const rows = analyzePensionStatus(employees, [], '2026-04')
    expect(rows).toHaveLength(1)
    expect(rows[0].employeeId).toBe('B')
  })

  it('excludes employees with past stopDate', () => {
    const employees = [
      makeEmployee({ employeeId: 'A', stopDate: new Date(2026, 0, 1) }),
      makeEmployee({ employeeId: 'B' }),
    ]
    const rows = analyzePensionStatus(employees, [], '2026-04')
    expect(rows).toHaveLength(1)
    expect(rows[0].employeeId).toBe('B')
  })
})

describe('analyzePensionStatus — missing data', () => {
  it('marks employee with no birthDate and no coverage as missing-data', () => {
    const employee = makeEmployee({ birthDate: null })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    expect(rows[0].status).toBe('חסר נתונים')
  })

  it('marks employee with no gender code as missing-data', () => {
    const employee = makeEmployee({ gender: '' })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    expect(rows[0].status).toBe('חסר נתונים')
  })

  it('does not mark covered employees as missing-data even if gender is missing', () => {
    const employee = makeEmployee({ gender: '' })
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה דוגמה',
      nationalId: '123456789',
      fundName: 'מנורה מבטחים פנסיה',
      fundType: 'לקצבה',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].status).toBe('יש קופה')
  })
})

describe('analyzePensionStatus — coverage classification', () => {
  it('detects pension fund', () => {
    const employee = makeEmployee()
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'מנורה מבטחים פנסיה',
      fundType: 'לקצבה',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].status).toBe('יש קופה')
    expect(rows[0].coverageKind).toBe('pension')
  })

  it('detects foreign deposit', () => {
    const employee = makeEmployee()
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'פקדון זרים',
      fundType: 'פקדון',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].status).toBe('יש קופה')
    expect(rows[0].coverageKind).toBe('foreign_deposit')
  })

  it('does not count training fund alone as pension', () => {
    const employee = makeEmployee({
      startDate: new Date(2024, 0, 1),
      birthDate: new Date(1990, 0, 1),
      gender: 'נ',
    })
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'קרן השתלמות',
      fundType: 'השתלמות',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].coverageKind).toBe('none')
  })

  it('flags ID mismatch', () => {
    const employee = makeEmployee()
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '999999999', // mismatch
      fundName: 'מנורה פנסיה',
      fundType: 'לקצבה',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].hasIdMismatch).toBe(true)
  })

  // Regression: emp 2115 case — fund "כלל חברה לביטוח" with type "לתגמולים".
  it('detects קופת גמל לתגמולים as pension coverage', () => {
    const employee = makeEmployee()
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'כלל חברה לביטוח',
      fundType: 'לתגמולים',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].status).toBe('יש קופה')
    expect(rows[0].coverageKind).toBe('pension')
  })

  it('detects פיקדון זרים מסתנן (plene spelling) as foreign deposit', () => {
    const employee = makeEmployee()
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'פיקדון זרים מסתנן',
      fundType: 'אחר',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].status).toBe('יש קופה')
    expect(rows[0].coverageKind).toBe('foreign_deposit')
  })

  it('rejects אובדן כושר עבודה rider as pension', () => {
    const employee = makeEmployee({
      startDate: new Date(2024, 0, 1),
      birthDate: new Date(1990, 0, 1),
      gender: 'נ',
    })
    const coverage: CoverageRecord = {
      employeeId: 'E1',
      employeeName: 'דוגמה',
      nationalId: '123456789',
      fundName: 'הראל אובדן כ.ע.',
      fundType: 'אובדן כ.ע. מעביד',
      taxYear: 2026,
    }
    const rows = analyzePensionStatus([employee], [coverage], '2026-04')
    expect(rows[0].coverageKind).toBe('none')
  })
})

describe('age + birth date on row', () => {
  it('computes age relative to report month', () => {
    const employee = makeEmployee({
      birthDate: new Date(1990, 5, 15),
      gender: 'נ',
    })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    // Born June 1990, report = April 2026 → still 35 (hasn't had June birthday yet in report month)
    // computeAge uses report month start (May 1 if report is "2026-04"... actually parseMonthInput gives April 2026 day=1)
    // April 2026 - June 1990 = 35 years (birthday in June not yet reached)
    expect(rows[0].age).toBe(35)
    expect(rows[0].birthDate).toEqual(new Date(1990, 5, 15))
  })

  it('age is null when birthDate is missing', () => {
    const employee = makeEmployee({ birthDate: null, gender: '' })
    const rows = analyzePensionStatus([employee], [], '2026-04')
    expect(rows[0].age).toBeNull()
  })
})
