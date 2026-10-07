import { localQaProvider } from '../qa/providers/localQaProvider'
import { onlineQaProvider } from '../qa/providers/onlineQaProvider'
import {
  listPromptMemories,
  markMemoriesReferenced,
  upsertMemory
} from '../storage/memoryStore'
import type { LongTermMemoryInput, LongTermMemoryType } from '../storage/memoryStore'
import type { QaMemoryContextMessage, QaProvider, QaProviderName } from '../qa/qaTypes'

interface MemoryExtractionInput {
  userMessage: string
  assistantMessage: string
  providerName: QaProviderName
}

interface MemoryCandidate {
  content?: unknown
  type?: unknown
  importance?: unknown
  confidence?: unknown
}

const PROMPT_MEMORY_LIMIT = 8
const PROMPT_MEMORY_MINIMUM_IMPORTANCE = 3
const MEMORY_EXTRACTION_MAX_CANDIDATES = 3
const MEMORY_EXTRACTION_MINIMUM_IMPORTANCE = 3
const MEMORY_EXTRACTION_MINIMUM_CONFIDENCE = 0.6

export function loadPromptMemoryContext(): QaMemoryContextMessage[] {
  try {
    const memories = listPromptMemories(PROMPT_MEMORY_LIMIT, PROMPT_MEMORY_MINIMUM_IMPORTANCE)

    if (memories.length > 0) {
      markMemoriesReferenced(memories.map((memory) => memory.id))
    }

    return memories.map((memory) => ({
      type: memory.type,
      content: memory.content
    }))
  } catch (error) {
    console.warn('[memory] Failed to load prompt memories: ' + getErrorMessage(error))
    return []
  }
}

export async function extractMemoriesFromExchange(input: MemoryExtractionInput): Promise<void> {
  const normalizedUserMessage = input.userMessage.trim()
  const normalizedAssistantMessage = input.assistantMessage.trim()
  if (!normalizedUserMessage || !normalizedAssistantMessage) return

  const provider = getExtractionProvider(input.providerName)
  if (!provider) return

  try {
    const response = await provider.ask(buildMemoryExtractionPrompt(input), {
      conversationContext: [],
      memoryContext: []
    })
    const candidates = parseMemoryCandidates(response.answer)

    for (const candidate of candidates) {
      upsertMemory(candidate)
    }
  } catch (error) {
    console.warn('[memory] Memory extraction skipped: ' + getErrorMessage(error))
  }
}

function getExtractionProvider(providerName: QaProviderName): QaProvider | undefined {
  if (providerName === 'online') return onlineQaProvider
  if (providerName === 'local') return localQaProvider

  return undefined
}

function buildMemoryExtractionPrompt(input: MemoryExtractionInput): string {
  return [
    '请分析下面这一轮用户和 MeiDou 的对话，判断是否有值得长期记忆的信息。',
    '只提炼稳定、可复用、对后续陪伴有帮助的信息，例如用户偏好、事实、正在做的项目、情绪倾向或待办。',
    '不要保存 API key、密码、token、银行卡、身份证、手机号、邮箱、地址等敏感信息。',
    '不要把用户原话整段保存，不要记录普通寒暄、一次性问题、临时闲聊。',
    '如果没有值得记忆的信息，返回 {"memories":[]}',
    '如果有，最多返回 3 条，content 用中文短句摘要，最长 60 字。',
    '只能输出 JSON，格式：{"memories":[{"content":"用户偏好摘要","type":"fact|preference|project|emotion|todo","importance":1-5,"confidence":0-1}]}',
    '',
    '用户：' + input.userMessage.trim(),
    'MeiDou：' + input.assistantMessage.trim()
  ].join('\n')
}

function parseMemoryCandidates(answer: string): LongTermMemoryInput[] {
  const parsed = parseJsonPayload(answer)
  if (!parsed || typeof parsed !== 'object') return []

  const memories = Array.isArray((parsed as { memories?: unknown }).memories)
    ? (parsed as { memories: unknown[] }).memories
    : Array.isArray(parsed)
      ? parsed
      : []

  return memories
    .map(normalizeMemoryCandidate)
    .filter((memory): memory is LongTermMemoryInput => Boolean(memory))
    .slice(0, MEMORY_EXTRACTION_MAX_CANDIDATES)
}

function normalizeMemoryCandidate(candidate: unknown): LongTermMemoryInput | undefined {
  if (!isRecord(candidate)) return undefined

  const value = candidate as MemoryCandidate
  const content = normalizeMemoryContent(value.content)
  const type = normalizeMemoryType(value.type)
  const importance = normalizeImportance(value.importance)
  const confidence = normalizeConfidence(value.confidence)

  if (!content || !type) return undefined
  if (importance < MEMORY_EXTRACTION_MINIMUM_IMPORTANCE) return undefined
  if (confidence < MEMORY_EXTRACTION_MINIMUM_CONFIDENCE) return undefined
  if (containsSensitiveContent(content)) return undefined

  return {
    content,
    type,
    importance,
    confidence
  }
}

function parseJsonPayload(text: string): unknown {
  const trimmedText = text.trim()
  if (!trimmedText) return undefined

  const fencedMatch = trimmedText.match(
    new RegExp(String.fromCharCode(96, 96, 96) + '(?:json)?\\s*([\\s\\S]*?)\\s*' + String.fromCharCode(96, 96, 96), 'i')
  )
  const jsonText = fencedMatch?.[1] ?? extractJsonObject(trimmedText)
  if (!jsonText) return undefined

  try {
    return JSON.parse(jsonText)
  } catch {
    return undefined
  }
}

function extractJsonObject(text: string): string | undefined {
  const firstObjectIndex = text.indexOf('{')
  const firstArrayIndex = text.indexOf('[')
  const candidates = [firstObjectIndex, firstArrayIndex].filter((index) => index >= 0)
  if (candidates.length === 0) return undefined

  const startIndex = Math.min(...candidates)
  const endCharacter = text[startIndex] === '[' ? ']' : '}'
  const endIndex = text.lastIndexOf(endCharacter)
  if (endIndex <= startIndex) return undefined

  return text.slice(startIndex, endIndex + 1)
}

function normalizeMemoryContent(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined

  const normalizedContent = content.trim().replace(/\s+/g, ' ')
  if (!normalizedContent || normalizedContent.length > 120) return undefined

  return normalizedContent
}

function normalizeMemoryType(type: unknown): LongTermMemoryType | undefined {
  if (
    type === 'fact' ||
    type === 'preference' ||
    type === 'project' ||
    type === 'emotion' ||
    type === 'todo'
  ) {
    return type
  }

  return undefined
}

function normalizeImportance(importance: unknown): number {
  const value = typeof importance === 'number' ? importance : Number(importance)
  if (!Number.isFinite(value)) return 3

  return Math.min(Math.max(Math.round(value), 1), 5)
}

function normalizeConfidence(confidence: unknown): number {
  const value = typeof confidence === 'number' ? confidence : Number(confidence)
  if (!Number.isFinite(value)) return 0.7

  return Math.min(Math.max(Number(value.toFixed(2)), 0), 1)
}

function containsSensitiveContent(content: string): boolean {
  const normalizedContent = content.toLocaleLowerCase()
  const sensitivePatterns = [
    /api\s*key/i,
    /secret/i,
    /token/i,
    /bearer/i,
    /password/i,
    /密码/,
    /口令/,
    /银行卡/,
    /信用卡/,
    /身份证/,
    /sk-[a-z0-9_-]{12,}/i,
    /\b\d{15,19}\b/,
    /\b\d{17}[\dx]\b/i
  ]

  return sensitivePatterns.some((pattern) => pattern.test(normalizedContent))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
