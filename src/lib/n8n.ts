import type { PensionStatusRow } from '../types'
import type { AgentExportSummary } from './export'
import { buildWebhookUrl, parseSendKey } from './sendKey'
import { formatMonth } from './pension'

// Webhook routing — kept as code constants so the user only enters the
// shared secret in the UI, not the env name or paths.
const DEFAULT_N8N_BASE_URL =
  (import.meta as unknown as { env?: { VITE_N8N_BASE_URL?: string } }).env?.VITE_N8N_BASE_URL ??
  'https://orenmeshi.app.n8n.cloud/webhook'

const SOURCE_NAME = 'orenmeshi'
const WHATSAPP_WEBHOOK_PATH = 'pension-notify'
const AGENT_EMAIL_WEBHOOK_PATH = 'pension-agent-email'

const PAYROLL_EMAIL = 'payroll@orenmeshi.com'

export interface SendResult {
  sent: number
  failed: number
  total: number
  warnings: Array<{
    employeeId: string | null
    name: string | null
    to_phone: string | null
    warning: string
  }>
  errors: Array<{
    employeeId: string | null
    name: string | null
    to_phone: string | null
    error: string
    statusCode?: number | null
  }>
}

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

export interface TestSendOptions {
  sendKey: string
  reportMonth: string
  testPhone: string
  templateText: string
  deadlineOverride?: string
}

export async function sendTestMessages(options: TestSendOptions): Promise<void> {
  const parsedKey = parseSendKey(options.sendKey)
  if (!parsedKey) {
    throw new Error('מפתח השליחה לא תקין. יש להזין סיקרט באורך 8 תווים לפחות.')
  }

  const phone = options.testPhone.trim()
  if (!phone) {
    throw new Error('צריך להזין מספר טלפון לבדיקה.')
  }

  const url = buildWebhookUrl(DEFAULT_N8N_BASE_URL, WHATSAPP_WEBHOOK_PATH)
  const sampleRow = buildSampleRow(phone, options.reportMonth)
  const rendered = renderTemplate(options.templateText, sampleRow, options.deadlineOverride)

  const employees = [
    {
      employeeId: 'test-pension',
      name: 'בדיקת טמפלייט',
      firstName: sampleRow.firstName,
      phone,
      eligibilityMonth: sampleRow.eligibilityMonth ? formatMonth(sampleRow.eligibilityMonth) : '',
      text: rendered,
      message: rendered,
    },
  ]

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Send-Key': parsedKey.secret,
    },
    body: JSON.stringify({
      source: SOURCE_NAME,
      reportMonth: options.reportMonth,
      sentAt: new Date().toISOString(),
      isTest: true,
      employees,
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

function buildSampleRow(phone: string, reportMonth: string): PensionStatusRow {
  const monthMatch = reportMonth.match(/^(\d{4})-(\d{2})$/)
  const eligibilityMonth = monthMatch
    ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
    : new Date()
  return {
    employeeId: 'test-sample',
    name: 'בדיקת טמפלייט',
    firstName: 'אורן',
    nationalId: '000000000',
    gender: '',
    email: '',
    age: 30,
    birthDate: null,
    startDate: null,
    eligibilityMonth,
    seventhMonth: null,
    ageEligibilityMonth: null,
    status: 'זכאי החודש',
    detail: '',
    monthsRemaining: 0,
    monthsLate: null,
    coverageKind: 'none',
    phone,
    department: '',
    city: '',
    address: '',
    fundLabels: [],
    primaryFund: 'כלל פנסיה',
    hasIdMismatch: false,
    grossSalary: null,
  }
}

export async function sendSelectedToN8n(options: WhatsAppSendOptions): Promise<SendResult> {
  const parsedKey = parseSendKey(options.sendKey)
  if (!parsedKey) {
    throw new Error('מפתח השליחה לא תקין. יש להזין סיקרט באורך 8 תווים לפחות.')
  }

  const url = buildWebhookUrl(DEFAULT_N8N_BASE_URL, WHATSAPP_WEBHOOK_PATH)
  const messages = buildRenderedMessages(options.rows, options.templateText, options.deadlineOverride)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Send-Key': parsedKey.secret,
    },
    body: JSON.stringify({
      source: SOURCE_NAME,
      reportMonth: options.reportMonth,
      sentAt: new Date().toISOString(),
      // nationalId is intentionally omitted: the WhatsApp template only uses
      // first name + eligibility month, so the sensitive ID is not sent to the
      // automation platform (data minimization).
      employees: messages.map((message) => ({
        employeeId: message.employeeId,
        name: message.name,
        firstName: message.firstName,
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
      if (data.message) message = data.message
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }

  const result = (await response.json()) as SendResult
  return result
}

export const PAYROLL_EMAIL_RENDERED = PAYROLL_EMAIL

// --- Agent email via n8n + Outlook -----------------------------------------

export interface AgentEmailSendOptions {
  sendKey: string // separate sendKey for the agent-email webhook
  agentEmail: string
  reportMonth: string
  fileBuffer: ArrayBuffer
  fileName: string
  summary: AgentExportSummary
}

export interface AgentEmailResult {
  sent: boolean
  messageId?: string
  to?: string
}

// Encodes the binary workbook + metadata and POSTs it to a separate n8n
// webhook. The n8n workflow is expected to decode `fileBase64` into a binary
// item and forward it through Microsoft Outlook (Send Email) as an attachment.
export async function sendAgentEmailViaN8n(
  options: AgentEmailSendOptions,
): Promise<AgentEmailResult> {
  const parsedKey = parseSendKey(options.sendKey)
  if (!parsedKey) {
    throw new Error('מפתח השליחה לא תקין. יש להזין סיקרט באורך 8 תווים לפחות.')
  }
  const recipient = options.agentEmail.trim()
  if (!recipient) {
    throw new Error('יש להזין כתובת מייל של סוכן הפנסיה לפני שליחה.')
  }

  const url = buildWebhookUrl(DEFAULT_N8N_BASE_URL, AGENT_EMAIL_WEBHOOK_PATH)
  const fileBase64 = arrayBufferToBase64(options.fileBuffer)
  const subject = `דוח עובדים לטיפול — ${options.reportMonth}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Send-Key': parsedKey.secret,
    },
    body: JSON.stringify({
      source: SOURCE_NAME,
      reportMonth: options.reportMonth,
      sentAt: new Date().toISOString(),
      to: recipient,
      subject,
      fileName: options.fileName,
      fileBase64,
      summary: options.summary,
    }),
  })

  if (!response.ok) {
    let message = `שליחת המייל נכשלה (סטטוס ${response.status}).`
    if (response.status === 404) {
      message =
        'ה-webhook של מייל הסוכן לא נמצא ב-n8n. ראה docs/n8n-agent-email-workflow.md.'
    }
    try {
      const data = (await response.json()) as { message?: string; error?: string }
      if (data.message) message = data.message
      else if (data.error) message = data.error
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }

  try {
    const data = (await response.json()) as Partial<AgentEmailResult>
    return { ...data, sent: true }
  } catch {
    return { sent: true }
  }
}

// btoa() chokes on long strings (`String.fromCharCode(...veryLargeArray)`
// throws "RangeError: Maximum call stack size exceeded"). Build the binary
// string in chunks instead.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  return btoa(binary)
}
