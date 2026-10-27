// The pension-eligibility tool moved into the payroll system (27.10.2026).
// This site now shows only this notice. On purpose there is no link: the
// payroll system sits behind its own sign-in, and the people who use it
// already reach it from there.

export const NOTICE_TITLE = 'בדיקת הזכאות לפנסיה עברה למערכת השכר'

export const NOTICE_LINES = [
  'מעכשיו בודקים את הזכאות, מורידים או שולחים את האקסל לסוכן הפנסיה ושולחים את הודעות הוואטסאפ לעובדים מתוך מערכת הכנת השכר, במסך "זכאות לפנסיה".',
  'האתר הזה כבר לא פעיל.',
]

export const NOTICE_SIGNATURE = 'מחלקת שכר, אורן משי'

// The old tool kept settings in the browser, including the n8n send key.
// The key is rotated with the move, and nothing here reads these any more.
const OLD_STORAGE_PREFIX = 'pension-status-'

export function clearOldStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): number {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k?.startsWith(OLD_STORAGE_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => storage.removeItem(k))
  return keys.length
}
