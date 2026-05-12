# n8n workflow — שליחת קובץ Excel לסוכן פנסיה במייל (Outlook)

**שם מומלץ ל-workflow:** `Pension Agent Email`
**Webhook path:** `pension-agent-email`
**מבוסס על workflow קיים:** [`xo83Ar4B7iPM0Zfr`](https://orenmeshi.app.n8n.cloud/workflow/xo83Ar4B7iPM0Zfr)
(אותו pattern של Microsoft Outlook → Send Email)

---

## תרשים זרימה

```
[Webhook trigger]
      ↓ JSON עם fileBase64
[Set / Code: פירוק base64 → binary]
      ↓ binary item
[Microsoft Outlook: Send Email]
      ↓
[Webhook Response: { sent: true, messageId, to }]
```

---

## שלב 1 — Webhook Trigger

| שדה | ערך |
|---|---|
| HTTP Method | `POST` |
| Path | `pension-agent-email` |
| Authentication | **Header Auth** — שם הקרדנשייאל: `Pension Agent Email Key` |
| Header name | `X-Send-Key` |
| Response Mode | `Last Node` (כדי שה-Outlook node יחזיר תוצאה לאתר) |

ה-AppUI שולח header `X-Send-Key: <secret>` לפי המפתח שמוזן בהגדרות
(פורמט `name=path=secret`).

### יצירת ה-credential
ב-n8n: `Credentials → New → Header Auth`
- Name: `Pension Agent Email Key`
- Header Name: `X-Send-Key`
- Header Value: סיקרט אקראי (מומלץ `openssl rand -hex 24`). העתק אותו —
  הוא ייכנס לסוף ה-sendKey באתר.

---

## שלב 2 — Code node: פירוק base64

הוסף `Code` node (JavaScript) בשם `Decode File`. ה-Webhook מעביר את הנתונים
כ-`$json.body` עם השדה `fileBase64`. צריך להפוך אותו ל-binary item.

```javascript
const item = $input.item;
const body = item.json.body ?? item.json;
const base64 = body.fileBase64;
if (!base64) {
  throw new Error('fileBase64 חסר ב-payload');
}
const buffer = Buffer.from(base64, 'base64');
return {
  json: {
    to: body.to,
    subject: body.subject,
    fileName: body.fileName,
    summary: body.summary,
    reportMonth: body.reportMonth,
  },
  binary: {
    data: {
      data: buffer.toString('base64'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: body.fileName,
      fileExtension: 'xlsx',
    },
  },
};
```

---

## שלב 3 — Microsoft Outlook: Send Email

חבר את ה-credential הקיים שלך (זה שמשמש ב-`xo83Ar4B7iPM0Zfr`).

| שדה | ערך |
|---|---|
| Resource | `Message` |
| Operation | `Send` |
| To Recipients | `={{ $json.to }}` |
| Subject | `={{ $json.subject }}` |
| Body Content Type | `HTML` |
| Body | ראה למטה |
| Attachments | `Add Attachment` → `Binary Property` = `data` |

### תוכן ה-Body (HTML)
```html
<p dir="rtl">שלום,</p>
<p dir="rtl">מצורף דוח עובדים לטיפול עבור חודש <strong>{{ $json.reportMonth }}</strong>.</p>
<p dir="rtl">הדוח מכיל:</p>
<ul dir="rtl">
  <li>סה״כ עובדים: <strong>{{ $json.summary.total }}</strong></li>
  <li>באיחור: {{ $json.summary.perStatus['באיחור'] }}</li>
  <li>זכאי החודש: {{ $json.summary.perStatus['זכאי החודש'] }}</li>
  <li>טרם זכאי: {{ $json.summary.perStatus['טרם זכאי'] }}</li>
  <li>יש קופה: {{ $json.summary.perStatus['יש קופה'] }}</li>
  <li><strong>לבדיקת קופות פעילות (רסטיגו): {{ $json.summary.activeFundsCount }}</strong></li>
</ul>
<p dir="rtl">בקובץ המצורף יש לשונית ייעודית "בדיקת קופות פעילות" עם הוראות
ייחודיות לכל לשונית.</p>
<p dir="rtl">תודה,<br/>מחלקת שכר, אורן משי 🩵</p>
```

---

## שלב 4 — Respond to Webhook

ה-Webhook ב-`Response Mode: Last Node`. ה-Outlook node מחזיר אובייקט עם
`id` (messageId). אם אין צורך בעיצוב נוסף, די בכך. אחרת אפשר להוסיף
`Respond to Webhook` node:

```json
{
  "sent": true,
  "messageId": "={{ $json.id }}",
  "to": "={{ $('Decode File').item.json.to }}"
}
```

---

## הזנת המפתח באתר

החל מ-2026-05-12 ה-AppUI משתמש **במפתח יחיד** לשני ה-webhooks (WhatsApp +
מייל סוכן). הסיקרט נשלח כ-header `X-Send-Key` לשני ה-webhooks. לכן:

1. צור את שני ה-credentials ב-n8n (אחד ל-WhatsApp, אחד למייל סוכן) — **עם
   אותו ערך header value**.
2. בהגדרות באתר: שדה **"מפתח שליחה"** = הסיקרט הזה (לפחות 8 תווים).
3. שם הסביבה (`orenmeshi`) ונתיבי ה-webhook (`pension-notify`,
   `pension-agent-email`) הם קבועים בקוד (`src/lib/n8n.ts`) ולא מופיעים
   ב-UI.

---

## בדיקה

1. הזן `agent@example.com` (או הכתובת שלך) בשדה "מייל סוכן הפנסיה".
2. הזן את `agentEmailSendKey`.
3. בחר עובדים בטבלה. לחץ **"שלח לסוכן במייל (n8n)"**.
4. הקובץ יורד אוטומטית למחשב, ובמקביל נשלח ל-Outlook → ל-`to`.
5. בדוק את ה-execution ב-n8n + את ה-inbox של הסוכן.

## שגיאות נפוצות

- **404 Not Found** — ה-webhook לא הופעל (חסר Activate ב-n8n).
- **401 Unauthorized** — Header `X-Send-Key` לא תואם ל-credential. בדוק
  שהסיקרט שב-AppUI זהה לערך ב-`Pension Agent Email Key`.
- **Outlook 401/403** — ה-credential של Microsoft Outlook פגה. חבר מחדש
  ב-`Credentials`.
- **base64 גדול** — קבצי 1MB+ ב-payload יכולים להאט את n8n. הקובץ של אתר
  הפנסיה הוא ~100KB, לא צפוי להיות בעיה.
