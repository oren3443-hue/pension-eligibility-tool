import { describe, it, expect } from 'vitest'
import { computeGrossSalaryByEmployee } from '../excel'

// Reproduces the structure of "דוח הרכב שכר וגמל מיכפל" — header in row 0,
// data in rows 1..N. Each row is one (employee, salary-component, fund)
// tuple. Pure-fund rows have an empty `שם רכיב שכר` and should be skipped.
function header(extra: string[] = []) {
  return [
    'מספר עובד',
    'שם העובד',
    'שם רכיב שכר',
    'סכום נדרש',
    'שווי נדרש',
    ...extra,
  ]
}

describe('computeGrossSalaryByEmployee', () => {
  it('sums סכום נדרש across all salary-component rows per employee', () => {
    const rows = [
      header(),
      ['192', 'דוגמה', 'משכורת', 20977, ''],
      ['192', 'דוגמה', 'משמרות', 18300, ''],
      ['192', 'דוגמה', 'אשל', 300, ''],
      ['192', 'דוגמה', 'שווי פלאפו', '', 20],
    ]
    const result = computeGrossSalaryByEmployee(rows)
    expect(result['192']).toBe(20977 + 18300 + 300)
  })

  it('skips fund-only rows (no salary component)', () => {
    const rows = [
      header(),
      ['2', 'אורנה', '', '', ''],
      ['2', 'אורנה', '', '', ''],
      ['3', 'דנה', 'משכורת', 5000, ''],
    ]
    const result = computeGrossSalaryByEmployee(rows)
    expect(result['2']).toBeUndefined()
    expect(result['3']).toBe(5000)
  })

  it('skips rows with no סכום נדרש (in-kind only)', () => {
    const rows = [
      header(),
      ['9', 'אפס', 'משכורת', 0, 0],
      ['9', 'אפס', 'בונוס', '', ''],
      ['9', 'אפס', 'שווי ארוחות', '', 249],
      ['9', 'אפס', 'נסיעות', 100, ''],
    ]
    const result = computeGrossSalaryByEmployee(rows)
    expect(result['9']).toBe(100)
  })

  it('handles string numbers (currency formatting)', () => {
    const rows = [
      header(),
      ['7', 'מחרוזת', 'משכורת', '12,500', ''],
      ['7', 'מחרוזת', 'נסיעות', '₪500', ''],
    ]
    const result = computeGrossSalaryByEmployee(rows)
    expect(result['7']).toBe(13000)
  })

  it('returns empty object when required headers are missing', () => {
    const rows = [
      ['something', 'else'],
      [1, 2],
    ]
    expect(computeGrossSalaryByEmployee(rows)).toEqual({})
  })

  it('aggregates across multiple rows for same employee', () => {
    const rows = [
      header(),
      ['1', 'א', 'משכורת', 1000, ''],
      ['1', 'א', 'בונוס', 500, ''],
      ['2', 'ב', 'משכורת', 2000, ''],
      ['1', 'א', 'נסיעות', 300, ''],
    ]
    const result = computeGrossSalaryByEmployee(rows)
    expect(result['1']).toBe(1800)
    expect(result['2']).toBe(2000)
  })
})
