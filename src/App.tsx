import { useEffect } from 'react'
import { NOTICE_LINES, NOTICE_SIGNATURE, NOTICE_TITLE, clearOldStorage } from './notice'

export default function App() {
  useEffect(() => {
    try {
      clearOldStorage(window.localStorage)
    } catch {
      // Storage can be blocked (private window); the notice still shows.
    }
  }, [])

  return (
    <main className="notice" dir="rtl">
      <section className="notice-card">
        <h1>{NOTICE_TITLE}</h1>
        {NOTICE_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="notice-signature">{NOTICE_SIGNATURE}</p>
      </section>
    </main>
  )
}
