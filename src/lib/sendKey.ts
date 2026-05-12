// The "send key" is just a shared secret used as the `X-Send-Key` header
// when calling the n8n webhooks. The environment name and webhook paths are
// implementation details kept as constants in `lib/n8n.ts` — the user only
// needs to know the secret.

const MIN_SECRET_LENGTH = 8

export interface ParsedSendKey {
  secret: string
}

export function parseSendKey(input: string): ParsedSendKey | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length < MIN_SECRET_LENGTH) return null
  return { secret: trimmed }
}

export function buildWebhookUrl(baseUrl: string, urlPath: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedPath = urlPath.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedPath}`
}
