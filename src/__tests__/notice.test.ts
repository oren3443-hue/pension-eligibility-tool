import { describe, expect, it } from 'vitest'
import { NOTICE_LINES, NOTICE_SIGNATURE, NOTICE_TITLE, clearOldStorage } from '../notice'

describe('the moved notice', () => {
  const all = [NOTICE_TITLE, ...NOTICE_LINES, NOTICE_SIGNATURE].join('\n')

  it('says the tool moved to the payroll system', () => {
    expect(NOTICE_TITLE).toContain('עברה למערכת השכר')
  })

  it('has no link or address in it', () => {
    expect(all).not.toMatch(/https?:|www\.|\.com|\.app|\.io|@/i)
  })

  it('clears only the old tool keys from browser storage', () => {
    const data = new Map([
      ['pension-status-settings-v4', '{"sendKey":"x"}'],
      ['pension-status-employee-state-v2', '{}'],
      ['something-else', 'keep'],
    ])
    const storage = {
      get length() {
        return data.size
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
    }
    expect(clearOldStorage(storage)).toBe(2)
    expect([...data.keys()]).toEqual(['something-else'])
  })
})
