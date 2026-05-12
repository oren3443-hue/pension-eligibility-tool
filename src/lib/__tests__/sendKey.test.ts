import { describe, it, expect } from 'vitest'
import { buildWebhookUrl, parseSendKey } from '../sendKey'

describe('parseSendKey', () => {
  it('accepts a non-empty secret of sufficient length', () => {
    expect(parseSendKey('s3cret-value-123')).toEqual({ secret: 's3cret-value-123' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseSendKey('   my-secret-key   ')).toEqual({ secret: 'my-secret-key' })
  })

  it('returns null for empty input', () => {
    expect(parseSendKey('')).toBeNull()
    expect(parseSendKey('   ')).toBeNull()
  })

  it('returns null for secrets shorter than 8 characters', () => {
    expect(parseSendKey('short')).toBeNull()
    expect(parseSendKey('1234567')).toBeNull()
    expect(parseSendKey('12345678')).toEqual({ secret: '12345678' })
  })

  it('does not interpret = characters specially', () => {
    // Legacy 3-part keys were name=path=secret; the new format treats them
    // as one opaque secret. That's intentional — users updating from the old
    // format will fail authentication and re-enter just the secret.
    const legacy = 'orenmeshi=pension/notify=secret123'
    expect(parseSendKey(legacy)).toEqual({ secret: legacy })
  })
})

describe('buildWebhookUrl', () => {
  it('joins base and path with single slash', () => {
    expect(buildWebhookUrl('https://n8n.example.com/webhook', 'pension/notify')).toBe(
      'https://n8n.example.com/webhook/pension/notify',
    )
  })

  it('strips trailing slashes from base', () => {
    expect(buildWebhookUrl('https://n8n.example.com/webhook//', 'a')).toBe(
      'https://n8n.example.com/webhook/a',
    )
  })

  it('strips leading slashes from path', () => {
    expect(buildWebhookUrl('https://n8n.example.com/webhook', '//a/b')).toBe(
      'https://n8n.example.com/webhook/a/b',
    )
  })
})
