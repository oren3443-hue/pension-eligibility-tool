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
  MessageCircleMore,
  RefreshCcw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'

import './App.css'
import { exportRowsToWorkbook } from './lib/export'
import { kindLabel, parseUploadedFile } from './lib/excel'
import { buildRenderedMessages, sendSelectedToN8n } from './lib/n8n'
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
  templateText: string
  deadlineOverride: string // ISO YYYY-MM-DD; empty = auto (15th of eligibility month)
}

interface FileSlots {
  employee: ParsedUploadedFile | null
  gmal: ParsedUploadedFile | null
  unknown: ParsedUploadedFile[]
}

type SlotKey = 'employee' | 'gmal'

const EMPLOYEE_STATE_STORAGE_KEY = 'pension-status-employee-state-v2'
const SETTINGS_STORAGE_KEY = 'pension-status-settings-v3'

const TEMPLATE_PRESET_A = `שלום {{first_name}} 👋

אנו שמחים לעדכן כי החל מחודש {{eligibility_month}} נתחיל בביצוע הפרשות פנסיוניות עבורך.

מה עליך לעשות?

באפשרותך לבחור את הקופה אליה תרצה שנפקיד את הכספים. את פרטי הקופה יש לשלוח למייל: {{payroll_email}}.

שימי לב: יש להעביר את הפרטים לא יאוחר מה-{{deadline_date}}.

במידה ולא יועברו פרטים עד למועד זה, ההפקדות יועברו באופן אוטומטי לקופת ברירת המחדל שתבחר עבורך, כדי לשמור על זכויותיך.

בברכה,
מחלקת שכר, אורן משי 🩵`

const TEMPLATE_PRESET_B = `שלום {{first_name}},

ברכות! החל מחודש העבודה {{eligibility_month}} תחל ההפרשה הפנסיונית שלך.

סוכן הפנסיה של החברה יצור איתך קשר בהקדם כדי לסייע לך בבחירת הקופה והמסלול המיטביים עבורך. עומדת לרשותך הזכות לבחור בכל סוכן או קופה אחרת לפי שיקול דעתך.

במידה ובחרת בקופה באופן עצמאי, עליך להעביר לנו את הפרטים עד ל-{{deadline_date}} לכתובת המייל: {{payroll_email}}.

בהצלחה,
מחלקת שכר, אורן משי 🩵`

const TEMPLATE_PRESET_C = `שלום {{first_name}},

עדכון קצר ממחלקת השכר: הפרשות הפנסיה שלך פעילות בקופה {{primary_fund}}.

אם ברצונך לשנות פרטי קופה, להוסיף מסמכים או לעדכן פרטים — אנא שלח/י אותם למייל: {{payroll_email}}.

תודה,
מחלקת שכר, אורן משי 🩵`

const DEFAULT_TEMPLATE_TEXT = TEMPLATE_PRESET_A

const SLOT_GUIDES: Record<SlotKey, { title: string; subtitle: string; export: string }> = {
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
}

function App() {
  const batchInputId = useId()
  const employeeInputId = useId()
  const gmalInputId = useId()
  const [reportMonth, setReportMonth] = useState(getCurrentMonthInputValue)
  const [isParsing, setIsParsing] = useState(false)
  const [isExportingAgent, setIsExportingAgent] = useState(false)
  const [isExportingFull, setIsExportingFull] = useState(false)
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false)
  const [fileSlots, setFileSlots] = useState<FileSlots>({
    employee: null,
    gmal: null,
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
  const [whatsappPreview, setWhatsappPreview] = useState<{
    rows: PensionStatusRow[]
  } | null>(null)

  const selectedEmployeeFile = fileSlots.employee
  const selectedGmalFile = fileSlots.gmal
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
          )
        : [],
    [selectedEmployeeFile, selectedGmalFile, analysisIssues.length, reportMonth],
  )

  const fundOptions = Array.from(new Set(rows.map((row) => row.primaryFund))).sort((a, b) =>
    a.localeCompare(b, 'he'),
  )

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

  useEffect(() => {
    window.localStorage.setItem(EMPLOYEE_STATE_STORAGE_KEY, JSON.stringify(employeeState))
  }, [employeeState])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  function applyParsedFiles(parsedGroups: ParsedUploadedFile[][], options: { reset?: boolean }) {
    let nextEmployee = options.reset ? null : fileSlots.employee
    let nextGmal = options.reset ? null : fileSlots.gmal
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

        nextUnknown.push(file)
      }
    }

    setFileSlots({
      employee: nextEmployee,
      gmal: nextGmal,
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
      const expectedKind = slot === 'employee' ? 'employee_data' : 'gmal_report'

      const matched = parsedFiles.find((parsed) => parsed.kind === expectedKind)
      if (!matched) {
        const expectedLabel = slot === 'employee' ? 'נתוני עובד' : 'דוח גמל'
        const detected = parsedFiles
          .map((parsed) => (parsed.kind === 'unknown' ? 'לא מזוהה' : kindLabel(parsed.kind)))
          .join(', ')
        setUploadError(
          `הקובץ שהועלה לא מתאים לשדה ${expectedLabel}. זוהה כ-${detected || 'לא מזוהה'}.`,
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

  async function handleAgentExport() {
    if (selectedRows.length === 0) {
      setActionMessage('בחר לפחות עובד אחד לפני ייצוא לסוכן.')
      return
    }

    setIsExportingAgent(true)
    setActionMessage('')

    try {
      await exportRowsToWorkbook(
        selectedRows.map((row) => buildAgentExportRow(row, employeeState[row.employeeId])),
        `pension-agent-${reportMonth}.xlsx`,
        'לסוכן פנסיה',
      )
      const timestamp = new Date().toISOString()
      updateEmployeeState(
        selectedRows.map((row) => row.employeeId),
        (current) => ({ ...current, exportedToAgentAt: timestamp }),
      )
      setActionMessage(`ירד קובץ סוכן עבור ${selectedRows.length} עובדים.`)
    } finally {
      setIsExportingAgent(false)
    }
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

  async function confirmWhatsappSend() {
    if (!whatsappPreview) return
    setIsSendingWhatsapp(true)
    setActionMessage('')

    try {
      await sendSelectedToN8n({
        sendKey: settings.sendKey,
        templateText: settings.templateText,
        reportMonth,
        rows: whatsappPreview.rows,
        deadlineOverride: settings.deadlineOverride || undefined,
      })
      const timestamp = new Date().toISOString()
      updateEmployeeState(
        whatsappPreview.rows.map((row) => row.employeeId),
        (current) => ({ ...current, whatsappSentAt: timestamp }),
      )
      setActionMessage(`נשלחו ${whatsappPreview.rows.length} הודעות פנסיה ל-n8n.`)
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

        <section className="file-band file-slots-2">
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
        </section>

        <section className="integration-band">
          <div className="integration-copy">
            <span className="eyebrow">n8n + WhatsApp</span>
            <h2>הגדרות שליחת הודעת פנסיה</h2>
            <p>
              ההודעה נשלחת לעובדים עצמם דרך webhook ב-n8n (ושם ל-Glassix). מפתח
              השליחה משלב שלושה חלקים: שם סביבה, נתיב webhook וסיקרט.
            </p>
          </div>

          <div className="integration-form">
            <label className="full-width">
              <span>מפתח שליחה (n8n)</span>
              <div className="input-row">
                <input
                  type={showSendKey ? 'text' : 'password'}
                  placeholder="orenmeshi=pension/notify=secret123"
                  value={settings.sendKey}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      sendKey: event.target.value.trim(),
                    }))
                  }
                  className={settings.sendKey && !sendKeyValid ? 'invalid' : ''}
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
                    ? '✓ מפתח תקין'
                    : '✗ פורמט שגוי. דוגמה: name=path=secret'
                  : 'פורמט: name=path=secret'}
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

            <label className="full-width">
              <span>טקסט הטמפלייט</span>
              <div className="template-presets">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setSettings((current) => ({ ...current, templateText: TEMPLATE_PRESET_A }))
                  }
                  title="הודעה לעובדים בלי קופה — מתחילה הפרשה"
                >
                  טען הודעה א (תחילת הפרשה)
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setSettings((current) => ({ ...current, templateText: TEMPLATE_PRESET_B }))
                  }
                  title="הודעה לעובדים בלי קופה — סוכן ייצור קשר"
                >
                  טען הודעה ב (סוכן ייצור קשר)
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    setSettings((current) => ({ ...current, templateText: TEMPLATE_PRESET_C }))
                  }
                  title="הודעה לעובדים שכבר יש להם קופה"
                >
                  טען הודעה ג (יש קופה)
                </button>
              </div>
              <textarea
                className="template-textarea"
                rows={12}
                value={settings.templateText}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    templateText: event.target.value,
                  }))
                }
              />
              <small>
                המשתנים נכנסים אוטומטית בשליחה. זמינים:{' '}
                <code>{'{{first_name}}'}</code>, <code>{'{{eligibility_month}}'}</code>,{' '}
                <code>{'{{deadline_date}}'}</code>, <code>{'{{payroll_email}}'}</code>,{' '}
                <code>{'{{primary_fund}}'}</code>
              </small>
            </label>
          </div>
        </section>

        {(uploadError ||
          actionMessage ||
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
                title="הורדת קובץ Excel של העובדים שנבחרו לשליחה ידנית לסוכן הפנסיה"
              >
                <Download size={18} />
                <span>{isExportingAgent ? 'מייצא...' : 'ייצוא לסוכן (Excel)'}</span>
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
          template={settings.templateText}
          deadlineOverride={settings.deadlineOverride || undefined}
          onCancel={() => setWhatsappPreview(null)}
          onConfirm={() => {
            void confirmWhatsappSend()
          }}
          isSending={isSendingWhatsapp}
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
  guide: { title: string; subtitle: string; export: string }
  file: ParsedUploadedFile | null
  inputId: string
  isParsing: boolean
  onChange: React.ChangeEventHandler<HTMLInputElement>
  onClear: () => void
}) {
  return (
    <article className={`file-card slot-card ${file ? 'valid' : ''}`}>
      <div className="file-card-top">
        <div>
          <span className="file-chip">{guide.title}</span>
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
        {file ? `זוהה כ-${kindLabel(file.kind as 'employee_data' | 'gmal_report')}` : guide.subtitle}
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

function buildAgentExportRow(row: PensionStatusRow, _actionState: EmployeeActionState | undefined) {
  void _actionState
  return {
    'מספר עובד': row.employeeId,
    שם: row.name,
    'מספר זהות': row.nationalId,
    טלפון: row.phone,
    'דוא"ל': row.email,
    גיל: row.age ?? '',
    'תאריך לידה': formatDate(row.birthDate),
    מחלקה: row.department,
    עיר: row.city,
    כתובת: row.address,
    קופה: row.primaryFund,
    סטטוס: row.status,
    'תחילת עבודה': formatDate(row.startDate),
    'חודש תחילת הפרשה': formatMonth(row.eligibilityMonth),
    'חודשים שנותרו / איחור': describeTimeline(row),
    פירוט: row.detail,
  }
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
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return { sendKey: '', templateText: DEFAULT_TEMPLATE_TEXT, deadlineOverride: '' }
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      sendKey: parsed.sendKey ?? '',
      templateText: parsed.templateText ?? DEFAULT_TEMPLATE_TEXT,
      deadlineOverride: parsed.deadlineOverride ?? '',
    }
  } catch {
    return { sendKey: '', templateText: DEFAULT_TEMPLATE_TEXT, deadlineOverride: '' }
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
