import type { PensionStatusRow } from '../types'
import { buildWebhookUrl, parseSendKey } from './sendKey'
import { formatMonth } from './pension'

const DEFAULT_N8N_BASE_URL =
  (import.meta as unknown as { env?: { VITE_N8N_BASE_URL?: string } }).env?.VITE_N8N_BASE_URL ??
  'https://orenmeshi.app.n8n.cloud/webhook'

const PAYROLL_EMAIL = 'payroll@orenmeshi.com'

export interface WhatsAppSendOptions {
  sendKey: string
  reportMonth: string
  rows: PensionStatusRow[]
  templateText: string
  deadlineOverride?: string // ISO date "YYYY-MM-DD"; if empty, auto = 15th of eligibility month
}

export interface RenderedMessage {
  employeeId: string
  name: string
  firstName: string
  phone: string
  nationalId: string
  eligibilityMonth: string
  text: string
}

export function renderTemplate(
  template: string,
  row: PensionStatusRow,
  deadlineOverride?: string,
): string {
  const firstName = row.firstName || row.name.split(' ')[0] || ''
  const eligibilityMonth = row.eligibilityMonth ? formatMonth(row.eligibilityMonth) : 'הקרוב'
  const deadlineDate = formatDeadlineDate(row.eligibilityMonth, deadlineOverride)
  const primaryFund = row.primaryFund || ''

  return template
    .replace(/\{\{\s*first_name\s*\}\}/g, firstName)
    .replace(/\{\{\s*eligibility_month\s*\}\}/g, eligibilityMonth)
    .replace(/\{\{\s*payroll_email\s*\}\}/g, PAYROLL_EMAIL)
    .replace(/\{\{\s*deadline_date\s*\}\}/g, deadlineDate)
    .replace(/\{\{\s*primary_fund\s*\}\}/g, primaryFund)
}

// Default deadline = 15th of the eligibility month, unless override is provided.
function formatDeadlineDate(eligibilityMonth: Date | null, override?: string): string {
  if (override) {
    const parsed = parseIsoDate(override)
    if (parsed) {
      return new Intl.DateTimeFormat('he-IL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(parsed)
    }
  }
  if (!eligibilityMonth) return 'הקרוב'
  const deadline = new Date(eligibilityMonth.getFullYear(), eligibilityMonth.getMonth(), 15)
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(deadline)
}

function parseIsoDate(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function buildRenderedMessages(
  rows: PensionStatusRow[],
  template: string,
  deadlineOverride?: string,
): RenderedMessage[] {
  return rows.map((row) => ({
    employeeId: row.employeeId,
    name: row.name,
    firstName: row.firstName || row.name.split(' ')[0] || '',
    phone: row.phone,
    nationalId: row.nationalId,
    eligibilityMonth: row.eligibilityMonth ? formatMonth(row.eligibilityMonth) : '',
    text: renderTemplate(template, row, deadlineOverride),
  }))
}

export async function sendSelectedToN8n(options: WhatsAppSendOptions): Promise<void> {
  const parsedKey = parseSendKey(options.sendKey)
  if (!parsedKey) {
    throw new Error('מפתח השליחה לא תקין. הפורמט הנדרש: name=path=secret')
  }

  const url = buildWebhookUrl(DEFAULT_N8N_BASE_URL, parsedKey.urlPath)
  const messages = buildRenderedMessages(options.rows, options.templateText, options.deadlineOverride)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Send-Key': parsedKey.secret,
    },
    body: JSON.stringify({
      source: parsedKey.name,
      reportMonth: options.reportMonth,
      sentAt: new Date().toISOString(),
      employees: messages.map((message) => ({
        employeeId: message.employeeId,
        name: message.name,
        firstName: message.firstName,
        nationalId: message.nationalId,
        phone: message.phone,
        eligibilityMonth: message.eligibilityMonth,
        text: message.text,
        message: message.text,
      })),
    }),
  })

  if (!response.ok) {
    let message = `קריאת webhook נכשלה עם סטטוס ${response.status}.`
    try {
      const data = (await response.json()) as { message?: string }
      if (data.message) {
        message = data.message
      }
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }
}

export const PAYROLL_EMAIL_ADDRESS = PAYROLL_EMAIL
