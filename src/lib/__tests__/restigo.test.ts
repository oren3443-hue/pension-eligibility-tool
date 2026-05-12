import { describe, it, expect } from 'vitest'
import { extractActiveFundEmployees } from '../restigo'
import type { EmployeeRecord, RestigoWorkforceRecord } from '../../types'

function makeRestigo(overrides: Partial<RestigoWorkforceRecord> = {}): RestigoWorkforceRecord {
  return {
    restigoId: '100',
    michpalId: '500',
    nationalId: '123456789',
    name: 'דוגמה דוגמה',
    branch: 'מפעל',
    salary: '₪35',
    startDate: new Date(2026, 3, 1),
    form101Status: 'מילא',
    fundIndicator: 'קיימת קרן פנסיה',
    fundName: 'מבטחים החדשה',
    ...overrides,
  }
}

function makeEmployee(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    employeeId: '500',
    name: 'דוגמה דוגמה',
    firstName: 'דוגמה',
    nationalId: '123456789',
    startDate: new Date(2026, 3, 1),
    birthDate: null,
    stopDate: null,
    stopReason: '',
    gender: '',
    email: '',
    phone: '',
    department: '',
    city: '',
    address: '',
    ...overrides,
  }
}

describe('extractActiveFundEmployees', () => {
  it('keeps only rows with text in fund name', () => {
    const result = extractActiveFundEmployees({
      records: [
        makeRestigo({ fundName: 'הראל' }),
        makeRestigo({ restigoId: '101', fundName: '' }),
        makeRestigo({ restigoId: '102', fundName: '   ' }),
        makeRestigo({ restigoId: '103', fundName: 'מגדל' }),
      ],
    })
    expect(result).toHaveLength(2)
    expect(new Set(result.map((r) => r.restigo.fundName))).toEqual(
      new Set(['מגדל', 'הראל']),
    )
  })

  it('matches by michpal id when employees provided', () => {
    const result = extractActiveFundEmployees({
      records: [makeRestigo({ michpalId: '500' })],
      employees: [makeEmployee({ employeeId: '500', name: 'מאצ׳ מיכפל' })],
    })
    expect(result[0].matchKind).toBe('by_michpal_id')
    expect(result[0].matchedMichpalEmployee?.name).toBe('מאצ׳ מיכפל')
  })

  it('falls back to national id match when michpal id missing', () => {
    const result = extractActiveFundEmployees({
      records: [makeRestigo({ michpalId: '', nationalId: '999000111' })],
      employees: [makeEmployee({ employeeId: '777', nationalId: '999000111' })],
    })
    expect(result[0].matchKind).toBe('by_national_id')
  })

  it('marks records as unmatched when no employee file is provided', () => {
    const result = extractActiveFundEmployees({
      records: [makeRestigo()],
    })
    expect(result[0].matchKind).toBe('unmatched')
    expect(result[0].matchedMichpalEmployee).toBeNull()
  })

  it('considers indicator-text mismatch but fundName-present case as active', () => {
    // Real-world case: indicator says "לא קיימת" but agent did register a fund.
    const result = extractActiveFundEmployees({
      records: [makeRestigo({ fundIndicator: 'לא קיימת קרן פנסיה', fundName: 'אלטשולר שחם' })],
    })
    expect(result).toHaveLength(1)
    expect(result[0].restigo.fundName).toBe('אלטשולר שחם')
  })

  it('sorts by start date descending', () => {
    const result = extractActiveFundEmployees({
      records: [
        makeRestigo({ restigoId: 'old', startDate: new Date(2025, 0, 1) }),
        makeRestigo({ restigoId: 'mid', startDate: new Date(2025, 5, 1) }),
        makeRestigo({ restigoId: 'new', startDate: new Date(2026, 3, 1) }),
      ],
    })
    expect(result.map((r) => r.restigo.restigoId)).toEqual(['new', 'mid', 'old'])
  })
})
