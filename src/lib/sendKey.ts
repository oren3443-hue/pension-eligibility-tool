export interface ParsedSendKey {
  name: string
  urlPath: string
  secret: string
}

export function parseSendKey(input: string): ParsedSendKey | null {
  if (!input) {
    return null
  }

  const parts = input.split('=').map((part) => part.trim())
  if (parts.length !== 3) {
    return null
  }

  const [name, urlPath, secret] = parts
  if (!name || !urlPath || !secret) {
    return null
  }

  return { name, urlPath, secret }
}

export function buildWebhookUrl(baseUrl: string, urlPath: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedPath = urlPath.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedPath}`
}
