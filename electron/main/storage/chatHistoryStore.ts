import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ChatMessageRole = 'user' | 'assistant'
export type ChatMessageSource = 'pet' | 'management'

export interface ChatHistoryMessage {
  id: string
  role: ChatMessageRole
  content: string
  createdAt: string
  source: ChatMessageSource
}

export type ChatHistoryMessageInput = Omit<ChatHistoryMessage, 'id' | 'createdAt'> &
  Partial<Pick<ChatHistoryMessage, 'id' | 'createdAt'>>

const CHAT_HISTORY_FILE = 'chat-history.jsonl'

export function appendMessage(message: ChatHistoryMessageInput): ChatHistoryMessage {
  const normalizedMessage = normalizeMessage(message)
  const filePath = getChatHistoryPath()

  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(normalizedMessage)}\n`, 'utf-8')

  return normalizedMessage
}

export function appendConversationMessage(
  role: ChatMessageRole,
  content: string,
  source: ChatMessageSource = 'pet'
): ChatHistoryMessage {
  return appendMessage({
    role,
    content,
    source
  })
}

export function listMessages(limit?: number): ChatHistoryMessage[] {
  const filePath = getChatHistoryPath()
  if (!existsSync(filePath)) return []

  const messages = readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map(parseMessageLine)
    .filter((message): message is ChatHistoryMessage => Boolean(message))

  const normalizedLimit = normalizeLimit(limit)
  return normalizedLimit ? messages.slice(-normalizedLimit) : messages
}

export function clearMessages(): void {
  const filePath = getChatHistoryPath()

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '', 'utf-8')
}

function getChatHistoryPath(): string {
  return join(app.getPath('userData'), CHAT_HISTORY_FILE)
}

function normalizeMessage(message: ChatHistoryMessageInput): ChatHistoryMessage {
  const content = normalizeContent(message.content)
  if (!content) {
    throw new Error('Chat message content cannot be empty.')
  }

  if (!isChatMessageRole(message.role)) {
    throw new Error('Chat message role is invalid.')
  }

  if (!isChatMessageSource(message.source)) {
    throw new Error('Chat message source is invalid.')
  }

  return {
    id: normalizeId(message.id) ?? randomUUID(),
    role: message.role,
    content,
    createdAt: normalizeCreatedAt(message.createdAt) ?? new Date().toISOString(),
    source: message.source
  }
}

function parseMessageLine(line: string): ChatHistoryMessage | undefined {
  const trimmedLine = line.trim()
  if (!trimmedLine) return undefined

  try {
    const value: unknown = JSON.parse(trimmedLine)
    if (!isRecord(value)) return undefined

    const id = normalizeId(value.id)
    const content = normalizeContent(value.content)
    const createdAt = normalizeCreatedAt(value.createdAt)
    if (
      !id ||
      !content ||
      !createdAt ||
      !isChatMessageRole(value.role) ||
      !isChatMessageSource(value.source)
    ) {
      return undefined
    }

    return {
      id,
      role: value.role,
      content,
      createdAt,
      source: value.source
    }
  } catch {
    return undefined
  }
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit) || limit <= 0) return undefined

  return Math.floor(limit)
}

function normalizeId(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined

  const normalizedId = id.trim()
  return normalizedId || undefined
}

function normalizeContent(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined

  const normalizedContent = content.trim()
  return normalizedContent || undefined
}

function normalizeCreatedAt(createdAt: unknown): string | undefined {
  if (typeof createdAt !== 'string') return undefined

  const normalizedCreatedAt = createdAt.trim()
  if (!normalizedCreatedAt) return undefined

  const timestamp = Date.parse(normalizedCreatedAt)
  if (!Number.isFinite(timestamp)) return undefined

  return new Date(timestamp).toISOString()
}

function isChatMessageRole(role: unknown): role is ChatMessageRole {
  return role === 'user' || role === 'assistant'
}

function isChatMessageSource(source: unknown): source is ChatMessageSource {
  return source === 'pet' || source === 'management'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
