import type { PensionStatusRow } from '../types'
import { buildWebhookUrl, parseSendKey } from './sendKey'
import { formatMonth } from './pension'

const DEFAULT_N8N_BASE_URL =
  (import.meta as unknown as { env?: { VITE_N8N_BASE_URL?: string } }).env?.VITE_N8N_BASE_URL ??
  'https://n8n.example.com/webhook'

const PAYROLL_EMAIL = 'payroll@orenmeshi.com'

export interface WhatsAppSendOptions {
  sendKey: string
  reportMonth: string
  rows: PensionStatusRow[]
  templateText: string
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

export function renderTemplate(template: string, row: PensionStatusRow): string {
  const firstName = row.firstName || row.name.split(' ')[0] || ''
  const eligibilityMonth = row.eligibilityMonth ? formatMonth(row.eligibilityMonth) : 'הקרוב'
  const deadlineDate = formatDeadlineDate(row.eligibilityMonth)

  return template
    .replace(/\{\{\s*first_name\s*\}\}/g, firstName)
    .replace(/\{\{\s*eligibility_month\s*\}\}/g, eligibilityMonth)
    .replace(/\{\{\s*payroll_email\s*\}\}/g, PAYROLL_EMAIL)
    .replace(/\{\{\s*deadline_date\s*\}\}/g, deadlineDate)
}

// 15th of the eligibility month — "המועד האחרון להעברת פרטי קופה"
function formatDeadlineDate(eligibilityMonth: Date | null): string {
  if (!eligibilityMonth) return 'הקרוב'
  const deadline = new Date(eligibilityMonth.getFullYear(), eligibilityMonth.getMonth(), 15)
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(deadline)
}

export function buildRenderedMessages(
  rows: PensionStatusRow[],
  template: string,
): RenderedMessage[] {
  return rows.map((row) => ({
    employeeId: row.employeeId,
    name: row.name,
    firstName: row.firstName || row.name.split(' ')[0] || '',
    phone: row.phone,
    nationalId: row.nationalId,
    eligibilityMonth: row.eligibilityMonth ? formatMonth(row.eligibilityMonth) : '',
    text: renderTemplate(template, row),
  }))
}

export async function sendSelectedToN8n(options: WhatsAppSendOptions): Promise<void> {
  const parsedKey = parseSendKey(options.sendKey)
  if (!parsedKey) {
    throw new Error('מפתח השליחה לא תקין. הפורמט הנדרש: name=path=secret')
  }

  const url = buildWebhookUrl(DEFAULT_N8N_BASE_URL, parsedKey.urlPath)
  const messages = buildRenderedMessages(options.rows, options.templateText)

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
