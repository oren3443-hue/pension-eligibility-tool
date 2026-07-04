import { useEffect, useId, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Filter,
  HelpCircle,
  Info,
  Mail,
  MessageCircleMore,
  RefreshCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'

import './App.css'
import {
  exportAgentWorkbook,
  exportRowsToWorkbook,
  triggerWorkbookDownload,
  type AgentExportSummary,
} from './lib/export'
import { kindLabel, parseUploadedFile, requiredHeadersFor } from './lib/excel'
import { extractActiveFundEmployees, type ActiveFundEmployee } from './lib/restigo'
import {
  buildRenderedMessages,
  sendAgentEmailViaN8n,
  sendSelectedToN8n,
  sendTestMessages,
  type SendResult,
} from './lib/n8n'
import { parseSendKey } from './lib/sendKey'
import {
  analyzePensionStatus,
  compareStatusRows,
  describeTimeline,
  formatDate,
  formatMonth,
  getCurrentMonthInputValue,
} from './lib/pension'
import type { ParsedUploadedFile, PensionStatus, PensionStatusRow } from './types'

interface EmployeeActionState {
  selected?: boolean
  exportedToAgentAt?: string
  whatsappSentAt?: string
}

interface AppSettings {
  sendKey: string
  deadlineOverride: string // ISO YYYY-MM-DD; empty = auto (15th of eligibility month)
  testPhone: string
  agentEmail: string
}

interface FileSlots {
  employee: ParsedUploadedFile | null
  gmal: ParsedUploadedFile | null
  restigo: ParsedUploadedFile | null
  unknown: ParsedUploadedFile[]
}

type SlotKey = 'employee' | 'gmal' | 'restigo'

const EMPLOYEE_STATE_STORAGE_KEY = 'pension-status-employee-state-v2'
const SETTINGS_STORAGE_KEY = 'pension-status-settings-v4'

// The single approved WhatsApp template — `pension_agent_intro_v1`. The
// 3-template design (א/ב/ג) was simplified to one nudge: the agent will
// reach out (no self-choose paragraph, no deadline). Any change to this
// text requires re-approval at Meta — see docs/whatsapp-templates.md.
const PENSION_TEMPLATE = `שלום {{first_name}} 👋

בשעה טובה! החל מחודש העבודה {{eligibility_month}} יתחילו עבורך ההפרשות הפנסיוניות 💰

כדי לסייע לך לבחור את המסלול המתאים ביותר עבורך, סוכן הפנסיה שלנו ייצור איתך קשר בקרוב 📞

חשוב לנו לציין כי עומדת לרשותך הזכות לבחור בכל סוכן פנסיוני, קרן או קופה אחרת לפי העדפתך.

בהצלחה,
מחלקת שכר
אורן משי 🩵`

const SLOT_GUIDES: Record<SlotKey, {
  title: string
  subtitle: string
  export: string
  optional?: boolean
}> = {
  employee: {
    title: 'נתוני עובד',
    subtitle: 'קובץ העובדים ממיכפל (פרטי עובד + סטטוס פעילים)',
    export: 'ייצוא במיכפל: ייצוא ← דוחות לאקסל ← נתוני עובד ← עד קוד הפסקה עבודה ‎-‎ 0',
  },
  gmal: {
    title: 'דוח גמל',
    subtitle: 'קובץ הרכב שכר וגמל',
    export: 'ייצוא במיכפל: ייצוא ← דוחות לאקסל ← הרכב שכר וגמל ← ללא שינוי במסננים',
  },
  restigo: {
    title: 'רסטיגו — מצבת כח אדם',
    subtitle: 'דוח מצבת כח אדם — לבדיקת קופות פעילות',
    export: 'ברסטיגו: דוחות ← מצבת כח אדם ← ייצוא לאקסל',
    optional: true,
  },
}

function App() {
  const batchInputId = useId()
  const employeeInputId = useId()
  const gmalInputId = useId()
  const restigoInputId = useId()
  const [reportMonth, setReportMonth] = useState(getCurrentMonthInputValue)
  const [isParsing, setIsParsing] = useState(false)
  const [isExportingAgent, setIsExportingAgent] = useState(false)
  const [isExportingFull, setIsExportingFull] = useState(false)
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [fileSlots, setFileSlots] = useState<FileSlots>({
    employee: null,
    gmal: null,
    restigo: null,
    unknown: [],
  })
  const [uploadError, setUploadError] = useState('')
  const [uploadIssues, setUploadIssues] = useState<string[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | PensionStatus>('all')
  const [fundFilter, setFundFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'urgency' | 'eligibility' | 'name'>('urgency')
  const [searchTerm, setSearchTerm] = useState('')
  const [employeeState, setEmployeeState] = useState<Record<string, EmployeeActionState>>(
    loadEmployeeState,
  )
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [showSendKey, setShowSendKey] = useState(false)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)
  const [whatsappPreview, setWhatsappPreview] = useState<{
    rows: PensionStatusRow[]
  } | null>(null)
  const [showTemplatePreview, setShowTemplatePreview] = useState(false)

  const selectedEmployeeFile = fileSlots.employee
  const selectedGmalFile = fileSlots.gmal
  const selectedRestigoFile = fileSlots.restigo
  const analysisIssues = [
    selectedEmployeeFile ? '' : 'חסר קובץ נתוני עובד.',
    selectedGmalFile ? '' : 'חסר קובץ דוח גמל.',
  ].filter(Boolean)

  const rows = useMemo(
    () =>
      selectedEmployeeFile && selectedGmalFile && analysisIssues.length === 0
        ? analyzePensionStatus(
            selectedEmployeeFile.employees,
            selectedGmalFile.coverages,
            reportMonth,
            selectedGmalFile.grossSalaryByEmployee,
          )
        : [],
    [selectedEmployeeFile, selectedGmalFile, analysisIssues.length, reportMonth],
  )

  const fundOptions = Array.from(new Set(rows.map((row) => row.primaryFund))).sort((a, b) =>
    a.localeCompare(b, 'he'),
  )

  const activeFundEmployees: ActiveFundEmployee[] = useMemo(() => {
    if (!selectedRestigoFile) return []
    return extractActiveFundEmployees({
      records: selectedRestigoFile.restigoWorkforce,
      employees: selectedEmployeeFile?.employees ?? [],
    })
  }, [selectedRestigoFile, selectedEmployeeFile])

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const filteredRows = rows
    .filter((row) => statusFilter === 'all' || row.status === statusFilter)
    .filter((row) => fundFilter === 'all' || row.primaryFund === fundFilter)
    .filter((row) => {
      if (!normalizedSearch) return true
      const haystack = `${row.name} ${row.firstName} ${row.employeeId} ${row.nationalId} ${row.phone} ${row.email} ${row.department}`.toLowerCase()
      return haystack.includes(normalizedSearch)
    })
    .sort((left, right) => compareStatusRows(left, right, sortBy))

  const selectedRows = rows.filter((row) => employeeState[row.employeeId]?.selected)
  const selectedFilteredCount = filteredRows.filter(
    (row) => employeeState[row.employeeId]?.selected,
  ).length

  const summary = {
    total: rows.length,
    covered: rows.filter((row) => row.status === 'יש קופה').length,
    dueNow: rows.filter((row) => row.status === 'זכאי החודש').length,
    late: rows.filter((row) => row.status === 'באיחור').length,
    missingData: rows.filter((row) => row.status === 'חסר נתונים').length,
    selected: selectedRows.length,
  }

  const sendKeyValid = parseSendKey(settings.sendKey) !== null
  const agentEmailValid = isValidEmail(settings.agentEmail.trim())

  useEffect(() => {
    window.localStorage.setItem(EMPLOYEE_STATE_STORAGE_KEY, JSON.stringify(employeeState))
  }, [employeeState])

  useEffect(() => {
    // Persist UI preferences only. The sendKey is the webhook auth secret and
    // is deliberately kept out of localStorage (memory-only for the session)
    // so it cannot be read from a shared/kiosk browser profile or via XSS.
    const { sendKey: _sendKey, ...persistable } = settings
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistable))
  }, [settings])

  function applyParsedFiles(parsedGroups: ParsedUploadedFile[][], options: { reset?: boolean }) {
    let nextEmployee = options.reset ? null : fileSlots.employee
    let nextGmal = options.reset ? null : fileSlots.gmal
    let nextRestigo = options.reset ? null : fileSlots.restigo
    const nextUnknown: ParsedUploadedFile[] = options.reset ? [] : [...fileSlots.unknown]
    const nextIssues: string[] = []

    for (const parsedFiles of parsedGroups) {
      for (const file of parsedFiles) {
        if (file.kind === 'employee_data') {
          if (nextEmployee) {
            nextIssues.push(`זוהה עוד קובץ נתוני עובד (${file.fileName}). נשמר הקובץ הקודם.`)
            continue
          }
          nextEmployee = file
          continue
        }

        if (file.kind === 'gmal_report') {
          if (nextGmal) {
            nextIssues.push(`זוהה עוד דוח גמל (${file.fileName}). נשמר הקובץ הקודם.`)
            continue
          }
          nextGmal = file
          continue
        }

        if (file.kind === 'restigo_workforce') {
          if (nextRestigo) {
            nextIssues.push(`זוהה עוד קובץ רסטיגו (${file.fileName}). נשמר הקובץ הקודם.`)
            continue
          }
          nextRestigo = file
          continue
        }

        nextUnknown.push(file)
      }
    }

    setFileSlots({
      employee: nextEmployee,
      gmal: nextGmal,
      restigo: nextRestigo,
      unknown: nextUnknown,
    })
    setUploadIssues(nextIssues)
  }

  async function handleBatchFilesChange(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }

    setIsParsing(true)
    setUploadError('')
    setUploadIssues([])
    setActionMessage('')

    try {
      const parsedGroups = await Promise.all(Array.from(fileList, parseUploadedFile))
      applyParsedFiles(parsedGroups, {})
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'שגיאה לא צפויה בזמן קריאת הקבצים.',
      )
    } finally {
      setIsParsing(false)
    }
  }

  async function handleSingleFileChange(slot: SlotKey, fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) {
      return
    }

    setIsParsing(true)
    setUploadError('')
    setUploadIssues([])
    setActionMessage('')

    try {
      const parsedFiles = await parseUploadedFile(file)
      const expectedKind =
        slot === 'employee' ? 'employee_data' : slot === 'gmal' ? 'gmal_report' : 'restigo_workforce'

      const matched = parsedFiles.find((parsed) => parsed.kind === expectedKind)
      if (!matched) {
        const expectedLabel =
          slot === 'employee' ? 'נתוני עובד' : slot === 'gmal' ? 'דוח גמל' : 'רסטיגו'
        const detected = parsedFiles
          .map((parsed) =>
            parsed.kind === 'unknown' ? 'לא מזוהה' : kindLabel(parsed.kind),
          )
          .join(', ')
        const required = requiredHeadersFor(expectedKind).join(', ')
        const missingHint = parsedFiles
          .flatMap((parsed) =>
            parsed.candidateKind === expectedKind && parsed.missingHeaders.length > 0
              ? [`חסרות הכותרות: ${parsed.missingHeaders.join(', ')}.`]
              : [],
          )
          .join(' ')
        setUploadError(
          `הקובץ שהועלה לא מתאים לשדה ${expectedLabel}. זוהה כ-${detected || 'לא מזוהה'}. ${
            missingHint || `שדות חובה: ${required}.`
          }`,
        )
        return
      }

      applyParsedFiles([parsedFiles], {})
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'שגיאה לא צפויה בזמן קריאת הקובץ.',
      )
    } finally {
      setIsParsing(false)
    }
  }

  function clearSlot(slot: SlotKey) {
    setFileSlots((current) => ({
      ...current,
      [slot]: null,
    }))
    setActionMessage('')
    setUploadError('')
  }

  function clearAllFiles() {
    setFileSlots({
      employee: null,
      gmal: null,
      restigo: null,
      unknown: [],
    })
    setUploadError('')
    setUploadIssues([])
    setActionMessage('')
  }

  function updateEmployeeState(
    employeeIds: string[],
    updater: (current: EmployeeActionState) => EmployeeActionState,
  ) {
    setEmployeeState((current) => {
      const nextState = { ...current }
      for (const employeeId of employeeIds) {
        nextState[employeeId] = updater(current[employeeId] ?? {})
      }
      return nextState
    })
  }

  function selectFilteredRows(selected: boolean) {
    updateEmployeeState(
      filteredRows.map((row) => row.employeeId),
      (current) => ({ ...current, selected }),
    )
  }

  async function handleAgentExport(options?: { thenEmail?: boolean }) {
    if (selectedRows.length === 0) {
      setActionMessage('בחר לפחות עובד אחד לפני ייצוא לסוכן.')
      return null
    }

    const trimmedAgentEmail = settings.agentEmail.trim()
    const trimmedAgentEmailValid = isValidEmail(trimmedAgentEmail)

    if (options?.thenEmail) {
      if (!trimmedAgentEmailValid) {
        setActionMessage('כדי לשלוח לסוכן במייל יש להזין כתובת מייל תקינה בהגדרות.')
        return null
      }
      if (!sendKeyValid) {
        setActionMessage(
          'כדי לשלוח לסוכן במייל יש להזין מפתח שליחה תקין בהגדרות.',
        )
        return null
      }
    }

    setIsExportingAgent(true)
    setActionMessage('')

    const fileName = `pension-agent-${reportMonth}.xlsx`
    try {
      const { buffer, summary } = await exportAgentWorkbook(
        selectedRows,
        activeFundEmployees.map((entry) => entry.restigo),
        { reportMonth, generatedAt: new Date() },
      )
      // Always download a local copy as proof — even when emailing.
      await triggerWorkbookDownload(buffer, fileName)
      const timestamp = new Date().toISOString()
      updateEmployeeState(
        selectedRows.map((row) => row.employeeId),
        (current) => ({ ...current, exportedToAgentAt: timestamp }),
      )

      if (options?.thenEmail) {
        try {
          const result = await sendAgentEmailViaN8n({
            sendKey: settings.sendKey,
            agentEmail: trimmedAgentEmail,
            reportMonth,
            fileBuffer: buffer,
            fileName,
            summary,
          })
          setActionMessage(
            `המייל נשלח ל-${result.to ?? trimmedAgentEmail} עם הקובץ "${fileName}" (${summary.total} עובדים, ${countTabsLabel(summary)}).`,
          )
        } catch (error) {
          setActionMessage(
            error instanceof Error
              ? `הקובץ ירד מקומית אך שליחת המייל נכשלה: ${error.message}`
              : 'הקובץ ירד מקומית אך שליחת המייל נכשלה.',
          )
        }
      } else {
        setActionMessage(
          `ירד קובץ סוכן עם ${summary.total} עובדים ב-${countTabsLabel(summary)}.`,
        )
      }
      return summary
    } finally {
      setIsExportingAgent(false)
    }
  }

  function isValidEmail(value: string): boolean {
    if (!value) return false
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  async function handleFullExport() {
    if (rows.length === 0) {
      setActionMessage('אין טבלה לייצוא כרגע.')
      return
    }

    setIsExportingFull(true)
    setActionMessage('')

    try {
      await exportRowsToWorkbook(
        filteredRows.map((row) => buildFullExportRow(row, employeeState[row.employeeId])),
        `pension-analysis-${reportMonth}.xlsx`,
        'טבלת סטטוסים',
      )
      setActionMessage(`ירד קובץ מלא עם ${filteredRows.length} שורות בהתאם לסינון הנוכחי.`)
    } finally {
      setIsExportingFull(false)
    }
  }

  function openWhatsappPreview() {
    if (selectedRows.length === 0) {
      setActionMessage('בחר לפחות עובד אחד לפני שליחת הודעת פנסיה.')
      return
    }

    if (!sendKeyValid) {
      setActionMessage('צריך להזין מפתח שליחה תקין (פורמט name=path=secret) לפני שליחה.')
      return
    }

    const eligibleRows = selectedRows.filter((row) => row.phone)

    if (eligibleRows.length === 0) {
      setActionMessage('לא נמצאו עובדים נבחרים עם טלפון. ודא שלעובדים יש מספר טלפון תקין.')
      return
    }

    setWhatsappPreview({ rows: eligibleRows })
  }

  async function handleSendTest() {
    if (!sendKeyValid) {
      setActionMessage('צריך להזין מפתח שליחה תקין (פורמט name=path=secret) לפני שליחה.')
      return
    }
    const phone = settings.testPhone.trim()
    if (!phone) {
      setActionMessage('צריך להזין מספר טלפון לבדיקה.')
      return
    }

    setIsSendingTest(true)
    setActionMessage('')
    try {
      await sendTestMessages({
        sendKey: settings.sendKey,
        reportMonth,
        testPhone: phone,
        templateText: PENSION_TEMPLATE,
        deadlineOverride: settings.deadlineOverride || undefined,
      })
      setActionMessage(`נשלחה הודעת בדיקה ל-${phone}.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'שליחת בדיקה נכשלה.')
    } finally {
      setIsSendingTest(false)
    }
  }

  async function confirmWhatsappSend() {
    if (!whatsappPreview) return
    setIsSendingWhatsapp(true)
    setActionMessage('')

    try {
      const result = await sendSelectedToN8n({
        sendKey: settings.sendKey,
        templateText: PENSION_TEMPLATE,
        reportMonth,
        rows: whatsappPreview.rows,
        deadlineOverride: settings.deadlineOverride || undefined,
      })
      const timestamp = new Date().toISOString()
      updateEmployeeState(
        whatsappPreview.rows.map((row) => row.employeeId),
        (current) => ({ ...current, whatsappSentAt: timestamp }),
      )
      setSendResult(result)
      setWhatsappPreview(null)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'שליחת webhook נכשלה.')
    } finally {
      setIsSendingWhatsapp(false)
    }
  }

  return (
    <div className="app-shell" dir="rtl">
      <header className="hero-band">
        <div className="hero-copy">
          <span className="eyebrow">בקרת פנסיה לשכר</span>
          <h1>סטטוס הפרשות פנסיה לעובדים</h1>
          <p>
            העלאת שני קבצי מקור ממיכפל, זיהוי אוטומטי לפי התוכן, סימון עובדים לעבודה
            מול הסוכן, ייצוא אקסל מסודר, ושליחת הודעות וואטסאפ אישיות לעובדים דרך n8n.
          </p>
        </div>

        <div className="hero-kpis" aria-label="תמונת מצב">
          <article className="kpi-card">
            <Users size={18} />
            <div>
              <strong>{summary.total || 0}</strong>
              <span>סה&quot;כ עובדים פעילים</span>
            </div>
          </article>
          <article className="kpi-card good">
            <CheckCircle2 size={18} />
            <div>
              <strong>{summary.covered}</strong>
              <span>יש קופה</span>
            </div>
          </article>
          <article className="kpi-card warning">
            <CalendarClock size={18} />
            <div>
              <strong>{summary.dueNow}</strong>
              <span>זכאי החודש</span>
            </div>
          </article>
          <article className="kpi-card danger">
            <ShieldAlert size={18} />
            <div>
              <strong>{summary.late}</strong>
              <span>באיחור</span>
            </div>
          </article>
          {summary.missingData > 0 && (
            <article className="kpi-card muted">
              <HelpCircle size={18} />
              <div>
                <strong>{summary.missingData}</strong>
                <span>חסר נתונים</span>
              </div>
            </article>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="control-band">
          <div className="month-panel">
            <label htmlFor="report-month">חודש דיווח</label>
            <input
              id="report-month"
              type="month"
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
            />
            <p>החישוב מתבצע מול {formatMonth(parseMonthValue(reportMonth))}.</p>
          </div>

          <div className="upload-panel">
            <div className="upload-copy">
              <label htmlFor={batchInputId}>העלאה מהירה</label>
              <p>
                אפשר להעלות את שני הקבצים יחד לזיהוי אוטומטי, או להעלות אותם
                בנפרד דרך הכרטיסים שמתחת.
              </p>
            </div>

            <div className="upload-actions">
              <label className="upload-button" htmlFor={batchInputId}>
                <Upload size={18} />
                <span>{isParsing ? 'קורא קבצים...' : 'העלאת קבצים יחד'}</span>
              </label>
              <input
                id={batchInputId}
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={(event) => {
                  void handleBatchFilesChange(event.target.files)
                  event.target.value = ''
                }}
              />
              <button type="button" className="ghost-button" onClick={clearAllFiles}>
                <Trash2 size={16} />
                <span>ניקוי הכל</span>
              </button>
            </div>
          </div>
        </section>

        <section className="file-band file-slots-3">
          <FileSlotCard
            guide={SLOT_GUIDES.employee}
            file={fileSlots.employee}
            inputId={employeeInputId}
            isParsing={isParsing}
            onChange={(event) => {
              void handleSingleFileChange('employee', event.target.files)
              event.target.value = ''
            }}
            onClear={() => clearSlot('employee')}
          />
          <FileSlotCard
            guide={SLOT_GUIDES.gmal}
            file={fileSlots.gmal}
            inputId={gmalInputId}
            isParsing={isParsing}
            onChange={(event) => {
              void handleSingleFileChange('gmal', event.target.files)
              event.target.value = ''
            }}
            onClear={() => clearSlot('gmal')}
          />
          <FileSlotCard
            guide={SLOT_GUIDES.restigo}
            file={fileSlots.restigo}
            inputId={restigoInputId}
            isParsing={isParsing}
            onChange={(event) => {
              void handleSingleFileChange('restigo', event.target.files)
              event.target.value = ''
            }}
            onClear={() => clearSlot('restigo')}
          />
        </section>

        {selectedRestigoFile && (
          <RestigoActiveFundsPanel
            entries={activeFundEmployees}
            restigoFile={selectedRestigoFile}
            employeeFile={selectedEmployeeFile}
          />
        )}

        <section className="integration-band">
          <div className="integration-copy">
            <span className="eyebrow">n8n + WhatsApp</span>
            <h2>הגדרות שליחת הודעת פנסיה</h2>
            <p>
              ההודעות לעובדים (WhatsApp דרך Glassix) ולסוכן הפנסיה (מייל דרך
              Outlook) נשלחות דרך n8n. אותו סיקרט משמש לשני סוגי השליחה — די
              להזין אותו פעם אחת כאן.
            </p>
          </div>

          <div className="integration-form">
            <label className="full-width">
              <span>מפתח שליחה</span>
              <div className="input-row">
                <input
                  type={showSendKey ? 'text' : 'password'}
                  placeholder="הזן את הסיקרט מ-n8n"
                  value={settings.sendKey}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      sendKey: event.target.value,
                    }))
                  }
                  className={settings.sendKey && !sendKeyValid ? 'invalid' : ''}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowSendKey((current) => !current)}
                  aria-label={showSendKey ? 'הסתרה' : 'הצגה'}
                >
                  {showSendKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <small>
                {settings.sendKey
                  ? sendKeyValid
                    ? '✓ מפתח תקין. אותו מפתח משמש לשליחת WhatsApp ולמייל לסוכן.'
                    : '✗ הסיקרט קצר מדי (נדרשים לפחות 8 תווים).'
                  : 'הזן את הסיקרט שהגדרת ב-credential של n8n (לפחות 8 תווים).'}
              </small>
            </label>

            <label>
              <span>תאריך אחרון לשליחת פרטים (override ל-{`{{deadline_date}}`})</span>
              <input
                type="date"
                value={settings.deadlineOverride}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    deadlineOverride: event.target.value,
                  }))
                }
              />
              <small>
                ריק = ברירת מחדל (15 לחודש הזכאות לכל עובד). תאריך = מחליף לכל הנמענים.
              </small>
            </label>

            <label>
              <span>מייל סוכן הפנסיה</span>
              <input
                type="email"
                placeholder="agent@example.com"
                value={settings.agentEmail}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    agentEmail: event.target.value.trim(),
                  }))
                }
                className={
                  settings.agentEmail && !isValidEmail(settings.agentEmail)
                    ? 'invalid'
                    : ''
                }
              />
              <small>
                {settings.agentEmail
                  ? isValidEmail(settings.agentEmail)
                    ? '✓ נשלח כקובץ מצורף דרך n8n + Outlook.'
                    : '✗ כתובת מייל לא תקינה.'
                  : 'הסוכן יקבל את הקובץ דרך n8n + Outlook (לא mailto).'}
              </small>
            </label>

            <label className="full-width">
              <span>טקסט ההודעה לעובד (WhatsApp)</span>
              <p className="template-help">
                ההודעה נשלחת לעובדים שטרם נפתחה להם קופת פנסיה — היא מודיעה
                שהפרשות מתחילות ושסוכן הפנסיה יצור איתם קשר. נוסח אחיד מאושר
                ב-Meta תחת השם <code>pension_agent_contact_v2</code>. כל שינוי
                בטקסט מצריך אישור מחדש — מסיבה זו אין כאן עורך.
              </p>
              <div className="template-presets">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowTemplatePreview(true)}
                  title="פתיחת תצוגה מקדימה של ההודעה על נתוני דמה"
                >
                  <Eye size={16} />
                  <span>תצוגה מקדימה</span>
                </button>
              </div>
              <small>
                משתנים שמוחלפים בשליחה:{' '}
                <code>{'{{first_name}}'}</code>, <code>{'{{eligibility_month}}'}</code>.
              </small>
            </label>

            <label className="full-width">
              <span>בדיקת תבנית — שלח את ההודעה אלי לטלפון</span>
              <div className="template-presets">
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="05XXXXXXXX"
                  value={settings.testPhone}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      testPhone: event.target.value,
                    }))
                  }
                  style={{ flex: 1, minWidth: '12rem' }}
                />
                <button
                  type="button"
                  className="upload-button"
                  onClick={() => {
                    void handleSendTest()
                  }}
                  disabled={isSendingTest || !sendKeyValid || !settings.testPhone.trim()}
                  title={
                    sendKeyValid
                      ? 'שליחת ההודעה על נתוני דמה למספר הבדיקה'
                      : 'יש להזין מפתח שליחה תקין'
                  }
                >
                  <MessageCircleMore size={16} />
                  <span>{isSendingTest ? 'שולח...' : 'שלח הודעת בדיקה אלי'}</span>
                </button>
              </div>
              <small>
                שולח את ההודעה לטלפון הזה עם נתוני דמה (אורן, חודש הדיווח הנוכחי). לא
                משפיע על העובדים האמיתיים ולא נספר ב-"נשלח".
              </small>
            </label>
          </div>
        </section>

        {(uploadError ||
          actionMessage ||
          sendResult ||
          analysisIssues.length > 0 ||
          uploadIssues.length > 0 ||
          fileSlots.unknown.length > 0) && (
          <section className="notice-band">
            {uploadError && (
              <p className="notice error">
                <AlertCircle size={18} />
                <span>{uploadError}</span>
              </p>
            )}

            {actionMessage && (
              <p className="notice info">
                <CheckCircle2 size={18} />
                <span>{actionMessage}</span>
              </p>
            )}

            {sendResult && (
              <div className="send-result">
                <div className="send-result-summary">
                  <span className="send-stat sent">
                    <CheckCircle2 size={16} /> נשלחו: {sendResult.sent}
                  </span>
                  {sendResult.failed > 0 && (
                    <span className="send-stat failed">
                      <AlertCircle size={16} /> שגיאות: {sendResult.failed}
                    </span>
                  )}
                  {sendResult.warnings?.length > 0 && (
                    <span className="send-stat warning">
                      <ShieldAlert size={16} /> אזהרות: {sendResult.warnings.length}
                    </span>
                  )}
                  <span className="send-stat total">סה"כ: {sendResult.total}</span>
                  <button className="ghost-button small" onClick={() => setSendResult(null)}>סגור</button>
                </div>
                {sendResult.warnings?.length > 0 && (
                  <ul className="send-warnings-list">
                    {sendResult.warnings.map((w, i) => (
                      <li key={i}>
                        <strong>{w.name || w.to_phone}</strong> — {w.warning}
                      </li>
                    ))}
                  </ul>
                )}
                {sendResult.errors.length > 0 && (
                  <ul className="send-errors-list">
                    {sendResult.errors.map((err, i) => (
                      <li key={i}>
                        <strong>{err.name || err.to_phone}</strong> — {err.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {analysisIssues.map((issue) => (
              <p className="notice warning" key={issue}>
                <ShieldAlert size={18} />
                <span>{issue}</span>
              </p>
            ))}

            {uploadIssues.map((issue) => (
              <p className="notice warning" key={issue}>
                <ShieldAlert size={18} />
                <span>{issue}</span>
              </p>
            ))}

            {fileSlots.unknown.map((file) => (
              <p className="notice muted" key={file.id}>
                <FileSpreadsheet size={18} />
                <span>
                  הקובץ {file.fileName}
                  {file.sheetName ? ` (גיליון "${file.sheetName}")` : ''} לא נכנס לניתוח.{' '}
                  {file.issues.join(' ')}
                </span>
              </p>
            ))}
          </section>
        )}

        <section className="table-band">
          <div className="table-head">
            <div>
              <span className="eyebrow">תוצאות</span>
              <h2>טבלת סטטוס עובדים</h2>
            </div>

            <div className="table-controls">
              <div className="filter-group" role="group" aria-label="סינון לפי סטטוס">
                <button
                  type="button"
                  className={statusFilter === 'all' ? 'is-active' : ''}
                  onClick={() => setStatusFilter('all')}
                >
                  כל העובדים
                </button>
                {STATUS_OPTIONS.map((status) => (
                  <button
                    type="button"
                    key={status}
                    className={statusFilter === status ? 'is-active' : ''}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <label className="search-control">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="חיפוש עובד (שם / ת.ז. / טלפון / מייל)"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </label>

              <label className="sort-control">
                <Filter size={16} />
                <span>קופה</span>
                <select
                  value={fundFilter}
                  onChange={(event) => setFundFilter(event.target.value)}
                >
                  <option value="all">כל הקופות</option>
                  {fundOptions.map((fund) => (
                    <option key={fund} value={fund}>
                      {fund}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sort-control">
                <Filter size={16} />
                <span>מיון</span>
                <select
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as 'urgency' | 'eligibility' | 'name')
                  }
                >
                  <option value="urgency">חריגות תחילה</option>
                  <option value="eligibility">חודש תחילת הפרשה</option>
                  <option value="name">שם עובד</option>
                </select>
              </label>
            </div>
          </div>

          <div className="action-bar">
            <div className="selection-summary">
              <strong>{summary.selected}</strong>
              <span>עובדים מסומנים</span>
              {selectedFilteredCount > 0 && (
                <em>{selectedFilteredCount} מתוך המסוננים הנוכחיים</em>
              )}
            </div>

            <div className="action-buttons">
              <button type="button" className="ghost-button" onClick={() => selectFilteredRows(true)}>
                בחר את כל המסוננים
              </button>
              <button type="button" className="ghost-button" onClick={() => selectFilteredRows(false)}>
                נקה סימון למסוננים
              </button>
              <button
                type="button"
                className="upload-button secondary"
                onClick={() => {
                  void handleAgentExport()
                }}
                disabled={isExportingAgent}
                title="הורדת קובץ Excel מעוצב עם לשוניות לפי סטטוס — לסוכן הפנסיה"
              >
                <Download size={18} />
                <span>{isExportingAgent ? 'מייצא...' : 'ייצוא לסוכן (Excel)'}</span>
              </button>
              <button
                type="button"
                className="upload-button secondary"
                onClick={() => {
                  void handleAgentExport({ thenEmail: true })
                }}
                disabled={
                  isExportingAgent ||
                  !agentEmailValid ||
                  !sendKeyValid
                }
                title={
                  !agentEmailValid
                    ? 'יש להזין כתובת מייל תקינה של הסוכן בהגדרות'
                    : !sendKeyValid
                      ? 'יש להזין מפתח שליחה תקין בהגדרות'
                      : `שולח קובץ Excel ל-${settings.agentEmail} דרך n8n + Outlook`
                }
              >
                <Mail size={18} />
                <span>
                  {isExportingAgent ? 'מכין...' : 'שלח לסוכן במייל (n8n)'}
                </span>
              </button>
              <button
                type="button"
                className="upload-button secondary"
                onClick={() => {
                  void handleFullExport()
                }}
                disabled={isExportingFull}
              >
                <FileSpreadsheet size={18} />
                <span>{isExportingFull ? 'מייצא...' : 'ייצוא מלא'}</span>
              </button>
              <button
                type="button"
                className="upload-button"
                onClick={openWhatsappPreview}
                disabled={isSendingWhatsapp || !sendKeyValid}
                title={
                  sendKeyValid
                    ? 'שליחת הודעות WhatsApp לכל העובדים שנבחרו (לכל הסטטוסים — דרוש רק טלפון)'
                    : 'יש להזין מפתח שליחה תקין'
                }
              >
                <MessageCircleMore size={18} />
                <span>{isSendingWhatsapp ? 'שולח...' : 'שלח WhatsApp לעובדים'}</span>
              </button>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="empty-state table-empty">
              <CalendarClock size={24} />
              <p>
                {rows.length === 0
                  ? 'הטבלה תופיע אחרי שיועלו נתוני עובד ודוח גמל.'
                  : 'אין שורות להצגה תחת הסינון הנוכחי.'}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>בחירה</th>
                    <th>מספר עובד</th>
                    <th>שם</th>
                    <th>גיל</th>
                    <th>תאריך לידה</th>
                    <th>טלפון</th>
                    <th>מחלקה</th>
                    <th>קופה</th>
                    <th>שכר ברוטו</th>
                    <th>תחילת עבודה</th>
                    <th>חודש תחילת הפרשה</th>
                    <th>חודשים שנותרו / איחור</th>
                    <th>סטטוס</th>
                    <th>פירוט</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <EmployeeRow
                      key={row.employeeId}
                      row={row}
                      actionState={employeeState[row.employeeId] ?? {}}
                      onToggleSelected={() =>
                        updateEmployeeState([row.employeeId], (current) => ({
                          ...current,
                          selected: !current.selected,
                        }))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {whatsappPreview && (
        <WhatsappPreviewModal
          rows={whatsappPreview.rows}
          template={PENSION_TEMPLATE}
          deadlineOverride={settings.deadlineOverride || undefined}
          onCancel={() => setWhatsappPreview(null)}
          onConfirm={() => {
            void confirmWhatsappSend()
          }}
          isSending={isSendingWhatsapp}
        />
      )}

      {showTemplatePreview && (
        <TemplatePreviewModal
          template={PENSION_TEMPLATE}
          reportMonth={reportMonth}
          deadlineOverride={settings.deadlineOverride || undefined}
          onClose={() => setShowTemplatePreview(false)}
        />
      )}
    </div>
  )
}

function FileSlotCard({
  guide,
  file,
  inputId,
  isParsing,
  onChange,
  onClear,
}: {
  guide: { title: string; subtitle: string; export: string; optional?: boolean }
  file: ParsedUploadedFile | null
  inputId: string
  isParsing: boolean
  onChange: React.ChangeEventHandler<HTMLInputElement>
  onClear: () => void
}) {
  return (
    <article className={`file-card slot-card ${file ? 'valid' : ''} ${guide.optional ? 'optional' : ''}`}>
      <div className="file-card-top">
        <div>
          <span className="file-chip">
            {guide.title}
            {guide.optional && <em className="slot-optional">רשות</em>}
          </span>
          <h2>
            {file
              ? file.sheetName
                ? `${file.fileName} → ${file.sheetName}`
                : file.fileName
              : guide.subtitle}
          </h2>
        </div>
        {file && <strong>{file.rowCount} שורות</strong>}
      </div>

      <p className="file-meta">
        {file
          ? `זוהה כ-${kindLabel(file.kind as 'employee_data' | 'gmal_report' | 'restigo_workforce')}`
          : guide.subtitle}
      </p>

      <p className="export-hint">
        <Info size={14} />
        <span>{guide.export}</span>
      </p>

      <div className="slot-actions">
        <label className="upload-button" htmlFor={inputId}>
          <RefreshCcw size={16} />
          <span>{file ? 'החלפת קובץ' : isParsing ? 'קורא...' : 'העלאת קובץ'}</span>
        </label>
        <input id={inputId} type="file" accept=".xlsx,.xls" onChange={onChange} />
        {file && (
          <button type="button" className="ghost-button" onClick={onClear}>
            <Trash2 size={16} />
            <span>הסר קובץ</span>
          </button>
        )}
      </div>
    </article>
  )
}

function EmployeeRow({
  row,
  actionState,
  onToggleSelected,
}: {
  row: PensionStatusRow
  actionState: EmployeeActionState
  onToggleSelected: () => void
}) {
  void actionState // keep for potential future per-row badges
  return (
    <tr className={`status-row ${statusClassName(row.status)}`}>
      <td>
        <input type="checkbox" checked={Boolean(actionState.selected)} onChange={onToggleSelected} />
      </td>
      <td className="numeric-cell">{row.employeeId}</td>
      <td>
        <div className="name-cell">
          <strong>{row.name}</strong>
          <span>{row.nationalId || 'ללא ת.ז.'}</span>
        </div>
      </td>
      <td className="numeric-cell">{row.age ?? '—'}</td>
      <td>{formatDate(row.birthDate)}</td>
      <td className="numeric-cell">{row.phone || '—'}</td>
      <td>{row.department || '—'}</td>
      <td>
        <span className={`fund-pill ${row.coverageKind}`}>{row.primaryFund}</span>
      </td>
      <td className="numeric-cell">
        {row.grossSalary !== null ? `${row.grossSalary.toLocaleString('he-IL')} ₪` : '—'}
      </td>
      <td>{formatDate(row.startDate)}</td>
      <td>{formatMonth(row.eligibilityMonth)}</td>
      <td className="numeric-cell">{describeTimeline(row)}</td>
      <td>
        <span className={`status-pill ${statusClassName(row.status)}`}>{row.status}</span>
      </td>
      <td>{row.detail}</td>
    </tr>
  )
}

function RestigoActiveFundsPanel({
  entries,
  restigoFile,
  employeeFile,
}: {
  entries: ActiveFundEmployee[]
  restigoFile: ParsedUploadedFile
  employeeFile: ParsedUploadedFile | null
}) {
  const [filter, setFilter] = useState<'all' | 'unmatched' | 'matched'>('all')
  const [search, setSearch] = useState('')

  const filtered = entries
    .filter((entry) => {
      if (filter === 'unmatched') return entry.matchKind === 'unmatched'
      if (filter === 'matched') return entry.matchKind !== 'unmatched'
      return true
    })
    .filter((entry) => {
      const needle = search.trim().toLowerCase()
      if (!needle) return true
      const r = entry.restigo
      const haystack = `${r.name} ${r.michpalId} ${r.restigoId} ${r.nationalId} ${r.fundName} ${r.branch}`.toLowerCase()
      return haystack.includes(needle)
    })

  return (
    <section className="restigo-band">
      <div className="restigo-head">
        <div>
          <span className="eyebrow">רסטיגו — בדיקת קופות פעילות</span>
          <h2>עובדים לבדיקת קופה פעילה ({entries.length})</h2>
          <p className="restigo-meta">
            {restigoFile.rowCount.toLocaleString('he-IL')} עובדים בדוח מצבת כח אדם
            {employeeFile && ` · ${employeeFile.rowCount.toLocaleString('he-IL')} עובדים פעילים במיכפל`}
            {' · '}
            רק עובדים עם טקסט בשם קרן פנסיה נכללים כאן
          </p>
        </div>

        <div className="restigo-controls">
          <div className="filter-group" role="group" aria-label="סינון">
            <button
              type="button"
              className={filter === 'all' ? 'is-active' : ''}
              onClick={() => setFilter('all')}
            >
              הכל ({entries.length})
            </button>
            <button
              type="button"
              className={filter === 'unmatched' ? 'is-active' : ''}
              onClick={() => setFilter('unmatched')}
            >
              חדשים לחלוטין ({entries.filter((e) => e.matchKind === 'unmatched').length})
            </button>
            <button
              type="button"
              className={filter === 'matched' ? 'is-active' : ''}
              onClick={() => setFilter('matched')}
            >
              קיימים במיכפל ({entries.filter((e) => e.matchKind !== 'unmatched').length})
            </button>
          </div>

          <label className="search-control">
            <Search size={16} />
            <input
              type="search"
              placeholder="חיפוש (שם / ת.ז. / קופה / סניף)"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state restigo-empty">
          <Sparkles size={24} />
          <p>
            לא נמצאו עובדים עם טקסט בעמודת "שם קרן פנסיה" בדוח. אין מה לשלוח לסוכן
            לבדיקה.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state restigo-empty">
          <p>אין שורות להצגה תחת הסינון/חיפוש הנוכחי.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="restigo-table">
            <thead>
              <tr>
                <th>שם</th>
                <th>מספר מיכפל</th>
                <th>מספר רסטיגו</th>
                <th>ת.ז.</th>
                <th>סניף</th>
                <th>תאריך תחילה</th>
                <th>שם קרן פנסיה</th>
                <th>מצב קרן פנסיה</th>
                <th>סטטוס התאמה</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={`${entry.restigo.restigoId}-${entry.restigo.nationalId}`}>
                  <td>
                    <div className="name-cell">
                      <strong>{entry.restigo.name || '—'}</strong>
                    </div>
                  </td>
                  <td className="numeric-cell">{entry.restigo.michpalId || '—'}</td>
                  <td className="numeric-cell">{entry.restigo.restigoId || '—'}</td>
                  <td className="numeric-cell">{entry.restigo.nationalId || '—'}</td>
                  <td>{entry.restigo.branch || '—'}</td>
                  <td>{entry.restigo.startDate ? formatDate(entry.restigo.startDate) : '—'}</td>
                  <td>
                    <span className="fund-pill">{entry.restigo.fundName}</span>
                  </td>
                  <td>{entry.restigo.fundIndicator || '—'}</td>
                  <td>
                    <span
                      className={`status-pill ${
                        entry.matchKind === 'unmatched' ? 'late' : 'covered'
                      }`}
                    >
                      {entry.matchKind === 'unmatched'
                        ? 'אין במיכפל'
                        : entry.matchKind === 'by_michpal_id'
                          ? 'תואם לפי מספר מיכפל'
                          : 'תואם לפי ת.ז.'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TemplatePreviewModal({
  template,
  reportMonth,
  deadlineOverride,
  onClose,
}: {
  template: string
  reportMonth: string
  deadlineOverride: string | undefined
  onClose: () => void
}) {
  const monthMatch = reportMonth.match(/^(\d{4})-(\d{2})$/)
  const eligibilityMonth = monthMatch
    ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
    : new Date()
  const sampleRow: PensionStatusRow = {
    employeeId: 'preview',
    name: 'אורן משי',
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
    phone: '0500000000',
    department: '',
    city: '',
    address: '',
    fundLabels: [],
    primaryFund: 'כלל פנסיה',
    hasIdMismatch: false,
    grossSalary: null,
  }
  const rendered = buildRenderedMessages([sampleRow], template, deadlineOverride)[0]

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header className="modal-head">
          <div>
            <span className="eyebrow">תצוגה מקדימה</span>
            <h2>ההודעה לעובד</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} aria-label="סגירה">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          <p className="modal-intro">
            כך תיראה ההודעה לעובד בפועל. המשתנים <code>{'{{first_name}}'}</code> ו-
            <code>{'{{eligibility_month}}'}</code> מוחלפים אוטומטית בעת השליחה.
          </p>
          <article className="message-preview">
            <div className="message-meta">
              <strong>{rendered.name}</strong>
              <span>{rendered.phone}</span>
            </div>
            <pre className="message-text">{rendered.text}</pre>
          </article>
        </div>

        <footer className="modal-footer">
          <button type="button" className="upload-button" onClick={onClose}>
            סגירה
          </button>
        </footer>
      </div>
    </div>
  )
}

function WhatsappPreviewModal({
  rows,
  template,
  deadlineOverride,
  onCancel,
  onConfirm,
  isSending,
}: {
  rows: PensionStatusRow[]
  template: string
  deadlineOverride: string | undefined
  onCancel: () => void
  onConfirm: () => void
  isSending: boolean
}) {
  const messages = buildRenderedMessages(rows, template, deadlineOverride)
  const first = messages[0]

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header className="modal-head">
          <div>
            <span className="eyebrow">תצוגה מקדימה לשליחה</span>
            <h2>שליחת WhatsApp ל-{messages.length} עובדים</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel} aria-label="סגירה">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          <p className="modal-intro">
            ההודעה הבאה תרונדר אישית לכל אחד מהעובדים שנבחרו. דוגמה לעובד הראשון:
          </p>
          {first && (
            <article className="message-preview">
              <div className="message-meta">
                <strong>{first.name}</strong>
                <span>{first.phone || 'אין טלפון'}</span>
              </div>
              <pre className="message-text">{first.text}</pre>
            </article>
          )}

          <details className="recipients-list">
            <summary>רשימת הנמענים ({messages.length})</summary>
            <ul>
              {messages.map((message) => (
                <li key={message.employeeId}>
                  <strong>{message.name}</strong> — {message.phone || 'אין טלפון'}
                </li>
              ))}
            </ul>
          </details>
        </div>

        <footer className="modal-footer">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isSending}>
            ביטול
          </button>
          <button
            type="button"
            className="upload-button"
            onClick={onConfirm}
            disabled={isSending}
          >
            <MessageCircleMore size={18} />
            <span>{isSending ? 'שולח...' : `שלח ל-${messages.length} עובדים`}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

function statusClassName(status: PensionStatus): string {
  switch (status) {
    case 'יש קופה':
      return 'covered'
    case 'טרם זכאי':
      return 'pending'
    case 'זכאי החודש':
      return 'due'
    case 'באיחור':
      return 'late'
    case 'חסר נתונים':
      return 'unknown-data'
    default:
      return ''
  }
}

function parseMonthValue(value: string): Date {
  const [yearPart, monthPart] = value.split('-')
  const year = Number.parseInt(yearPart ?? '', 10)
  const month = Number.parseInt(monthPart ?? '', 10)
  return Number.isNaN(year) || Number.isNaN(month) ? new Date() : new Date(year, month - 1, 1)
}

function countTabsLabel(summary: AgentExportSummary): string {
  const tabs: string[] = []
  if (summary.needFundCount > 0) {
    tabs.push(`עובדים לפתיחת קופה (${summary.needFundCount})`)
  }
  if (summary.activeFundsCount > 0) {
    tabs.push(`בדיקת קופות פעילות (${summary.activeFundsCount})`)
  }
  return `${tabs.length} לשוניות (${tabs.join(', ')})`
}

function buildFullExportRow(row: PensionStatusRow, _actionState: EmployeeActionState | undefined) {
  void _actionState
  return {
    'מספר עובד': row.employeeId,
    שם: row.name,
    'מספר זהות': row.nationalId,
    מין: row.gender || 'לא זמין',
    גיל: row.age ?? '',
    'תאריך לידה': formatDate(row.birthDate),
    טלפון: row.phone,
    'דוא"ל': row.email,
    מחלקה: row.department,
    עיר: row.city,
    כתובת: row.address,
    קופה: row.primaryFund,
    'סוג כיסוי': row.coverageKind,
    'שכר ברוטו': row.grossSalary ?? '',
    סטטוס: row.status,
    'תחילת עבודה': formatDate(row.startDate),
    'חודש 7': formatMonth(row.seventhMonth),
    'חודש גיל זכאות': formatMonth(row.ageEligibilityMonth),
    'חודש תחילת הפרשה': formatMonth(row.eligibilityMonth),
    'חודשים שנותרו': row.monthsRemaining ?? '',
    'חודשי איחור': row.monthsLate ?? '',
    פירוט: row.detail,
    'אי התאמה בתעודת זהות': row.hasIdMismatch ? 'כן' : 'לא',
  }
}

function loadEmployeeState(): Record<string, EmployeeActionState> {
  try {
    const raw = window.localStorage.getItem(EMPLOYEE_STATE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, EmployeeActionState>) : {}
  } catch {
    return {}
  }
}

function loadSettings(): AppSettings {
  const fallback: AppSettings = {
    sendKey: '',
    deadlineOverride: '',
    testPhone: '',
    agentEmail: '',
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      // sendKey is intentionally never restored from storage — re-entered
      // each session and held in memory only (see the persist effect).
      sendKey: '',
      deadlineOverride: parsed.deadlineOverride ?? '',
      testPhone: parsed.testPhone ?? '',
      agentEmail: parsed.agentEmail ?? '',
    }
  } catch {
    return fallback
  }
}

const STATUS_OPTIONS: PensionStatus[] = [
  'יש קופה',
  'טרם זכאי',
  'זכאי החודש',
  'באיחור',
  'חסר נתונים',
]

export default App
