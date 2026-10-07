import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SECRETS_FILE = 'secrets.json'

interface EncryptedSecrets {
  version: 1
  onlineApiKey?: string
}

export function loadOnlineApiKey(): string | undefined {
  const encryptedApiKey = loadEncryptedSecrets().onlineApiKey
  if (!encryptedApiKey || !safeStorage.isEncryptionAvailable()) return undefined

  try {
    const apiKey = safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64')).trim()
    return apiKey || undefined
  } catch {
    console.warn('[storage] Stored online API key could not be decrypted.')
    return undefined
  }
}

export function hasStoredOnlineApiKey(): boolean {
  return Boolean(loadOnlineApiKey())
}

export function saveOnlineApiKey(apiKey: string): void {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) return
  if (normalizedApiKey.length > 8192) {
    throw new Error('API Key 长度超过限制，未保存。')
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储当前不可用，API Key 未保存。')
  }

  const secrets: EncryptedSecrets = {
    version: 1,
    onlineApiKey: safeStorage.encryptString(normalizedApiKey).toString('base64')
  }

  writeFileSync(getSecretsPath(), JSON.stringify(secrets, null, 2), 'utf-8')
}

function loadEncryptedSecrets(): EncryptedSecrets {
  const filePath = getSecretsPath()
  if (!existsSync(filePath)) return { version: 1 }

  try {
    const data: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))

    if (isRecord(data) && typeof data.onlineApiKey === 'string') {
      return {
        version: 1,
        onlineApiKey: data.onlineApiKey
      }
    }
  } catch {
  }

  return { version: 1 }
}

function getSecretsPath(): string {
  return join(app.getPath('userData'), SECRETS_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
