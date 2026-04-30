# סטטוס הפרשות פנסיה לעובדים

כלי web פנימי (frontend בלבד) למחלקת השכר. מטרה: לזהות אילו עובדים זכאים להתחלת הפרשות פנסיה — מי שכבר התחילו זכאותם, מי שמתחיל החודש, ומי שטרם — ולשלוח להם הודעת WhatsApp אישית עם הוראות.

## מה הכלי עושה

1. קולט שלושה קבצים ממיכפל (זיהוי אוטומטי לפי כותרות, גם ב-multi-sheet):
   - **עובדים פעילים** — סינון מתבסס על `קוד הפסקה` (קוד 0 = פעיל)
   - **פרטי עובד** — מקור נתוני מין, מייל ותאריכים
   - **דוח גמל** — מקור נתוני קופות פנסיה
2. ממזג, מחשב חודש זכאות לפי הכלל המאוחר מבין:
   - חודש 7 לעבודה
   - חודש הגיל החוקי (זכר 21, נקבה 20)
3. סווג ל-5 סטטוסים: יש קופה / טרם זכאי / זכאי החודש / באיחור / חסר נתונים
4. מאפשר ייצוא Excel לסוכן (להורדה ולשליחה ידנית) או שליחת WhatsApp לעובדים דרך n8n
5. שומר בחירות והגדרות ב-localStorage

## פיתוח מקומי

```bash
npm install
npm run dev
```

## בדיקות

```bash
npm test          # vitest run
npm run build     # tsc + vite build
```

## פרסום ל-GitHub Pages

יש workflow מוכן ב-`.github/workflows/deploy-pages.yml`. כל `push` ל-`main` בונה ומפרסם.

לאחר העלאת הפרויקט ל-GitHub:
1. `Settings` → `Pages` → Source: `GitHub Actions`
2. ה-URL יופיע בקישור של ה-workflow

## הגדרת n8n + WhatsApp

ההודעות נשלחות לעובדים עצמם דרך webhook ב-n8n (שם רץ Glassix).

**מפתח שליחה (UI):** מחרוזת אחת בפורמט:

```
name=urlPath=secret
```

לדוגמה: `orenmeshi=pension/notify=abc123def456`

- `name` — שם סביבה (לזיהוי הלוגים)
- `urlPath` — נתיב ה-webhook ב-n8n
- `secret` — נשלח כ-header `X-Send-Key`

**Base URL** של n8n מוגדר ב-build דרך env var:

```bash
VITE_N8N_BASE_URL=https://n8n.your-domain.com/webhook npm run build
```

ברירת מחדל: `https://n8n.example.com/webhook`.

## טמפלייטים ומשתנים

שני טמפלייטים מוכנים (אפשר לטעון בלחיצה ולערוך). משתנים זמינים:

- `{{first_name}}` — שם פרטי
- `{{eligibility_month}}` — חודש תחילת ההפרשה (פורמט עברי)
- `{{deadline_date}}` — 15 לחודש הזכאות
- `{{payroll_email}}` — `payroll@orenmeshi.com`

הטקסט נרנדר אישית לכל עובד לפני שליחה ונשלח ל-n8n כ-`text` ו-`message` (טקסט סופי, לא reference לטמפלייט).

## Stack

React 19 · TypeScript · Vite · `xlsx` · `lucide-react` · `vitest`
