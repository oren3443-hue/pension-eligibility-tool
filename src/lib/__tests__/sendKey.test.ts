import { describe, it, expect } from 'vitest'
import { buildWebhookUrl, parseSendKey } from '../sendKey'

describe('parseSendKey', () => {
  it('parses a valid 3-part key', () => {
    expect(parseSendKey('orenmeshi=pension/notify=secret123')).toEqual({
      name: 'orenmeshi',
      urlPath: 'pension/notify',
      secret: 'secret123',
    })
  })

  it('trims whitespace around parts', () => {
    expect(parseSendKey('  test = a/b = xyz  ')).toEqual({
      name: 'test',
      urlPath: 'a/b',
      secret: 'xyz',
    })
  })

  it('returns null for empty input', () => {
    expect(parseSendKey('')).toBeNull()
  })

  it('returns null when fewer than 3 parts', () => {
    expect(parseSendKey('only=two')).toBeNull()
    expect(parseSendKey('one')).toBeNull()
  })

  it('returns null when more than 3 parts', () => {
    expect(parseSendKey('a=b=c=d')).toBeNull()
  })

  it('returns null when any part is empty', () => {
    expect(parseSendKey('a==c')).toBeNull()
    expect(parseSendKey('=b=c')).toBeNull()
    expect(parseSendKey('a=b=')).toBeNull()
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
