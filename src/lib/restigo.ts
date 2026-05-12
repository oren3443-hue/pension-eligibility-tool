import type { EmployeeRecord, RestigoWorkforceRecord } from '../types'

export type ActiveFundMatchKind = 'unmatched' | 'by_michpal_id' | 'by_national_id'

export interface ActiveFundEmployee {
  restigo: RestigoWorkforceRecord
  matchKind: ActiveFundMatchKind
  matchedMichpalEmployee: EmployeeRecord | null
}

interface ExtractOptions {
  records: RestigoWorkforceRecord[]
  employees?: EmployeeRecord[]
}

// Filter rule per the user's spec: include any Restigo workforce row where
// `שם קרן פנסיה` (fund name) has actual text. The `קרן פנסיה` indicator
// column is unreliable on its own — we have field cases where the indicator
// says "לא קיימת" but the fund name is still populated.
export function extractActiveFundEmployees(options: ExtractOptions): ActiveFundEmployee[] {
  const employeeByMichpalId = new Map<string, EmployeeRecord>()
  const employeeByNationalId = new Map<string, EmployeeRecord>()
  for (const employee of options.employees ?? []) {
    if (employee.employeeId) employeeByMichpalId.set(employee.employeeId, employee)
    if (employee.nationalId) employeeByNationalId.set(employee.nationalId, employee)
  }

  const result: ActiveFundEmployee[] = []
  for (const restigo of options.records) {
    if (!restigo.fundName || restigo.fundName.trim() === '') continue

    let matchKind: ActiveFundMatchKind = 'unmatched'
    let matched: EmployeeRecord | null = null
    if (restigo.michpalId && employeeByMichpalId.has(restigo.michpalId)) {
      matched = employeeByMichpalId.get(restigo.michpalId) ?? null
      matchKind = 'by_michpal_id'
    } else if (restigo.nationalId && employeeByNationalId.has(restigo.nationalId)) {
      matched = employeeByNationalId.get(restigo.nationalId) ?? null
      matchKind = 'by_national_id'
    }

    result.push({ restigo, matchKind, matchedMichpalEmployee: matched })
  }

  result.sort((left, right) => {
    const leftTime = left.restigo.startDate?.getTime() ?? 0
    const rightTime = right.restigo.startDate?.getTime() ?? 0
    return rightTime - leftTime
  })

  return result
}
