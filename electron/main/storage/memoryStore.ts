import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type LongTermMemoryType = 'fact' | 'preference' | 'project' | 'emotion' | 'todo'

export interface LongTermMemory {
  id: string
  content: string
  type: LongTermMemoryType
  importance: number
  confidence: number
  createdAt: string
  updatedAt: string
  lastReferencedAt: string
}

export interface LongTermMemoryInput {
  content: string
  type: LongTermMemoryType
  importance: number
  confidence: number
}

interface MemoryFilePayload {
  version: 1
  memories: LongTermMemory[]
}

const MEMORY_FILE = 'memories.json'
const MEMORY_FILE_VERSION = 1

export function listMemories(limit?: number): LongTermMemory[] {
  const memories = loadMemories()
    .map((memory) => ({ ...memory }))
    .sort(compareMemoriesForDisplay)
  const normalizedLimit = normalizeLimit(limit)

  return normalizedLimit ? memories.slice(0, normalizedLimit) : memories
}

export function listPromptMemories(limit = 8, minimumImportance = 3): LongTermMemory[] {
  const normalizedLimit = normalizeLimit(limit) ?? 8

  return loadMemories()
    .filter((memory) => memory.importance >= minimumImportance)
    .sort(compareMemoriesForPrompt)
    .slice(0, normalizedLimit)
    .map((memory) => ({ ...memory }))
}

export function upsertMemory(input: LongTermMemoryInput): LongTermMemory {
  const normalizedInput = normalizeMemoryInput(input)
  const memories = loadMemories()
  const now = new Date().toISOString()
  const duplicateIndex = memories.findIndex(
    (memory) =>
      normalizeComparableText(memory.content) === normalizeComparableText(normalizedInput.content)
  )

  if (duplicateIndex >= 0) {
    const existingMemory = memories[duplicateIndex]
    const updatedMemory: LongTermMemory = {
      ...existingMemory,
      content: normalizedInput.content,
      type: normalizedInput.type,
      importance: Math.max(existingMemory.importance, normalizedInput.importance),
      confidence: Math.max(existingMemory.confidence, normalizedInput.confidence),
      updatedAt: now
    }

    memories[duplicateIndex] = updatedMemory
    saveMemories(memories)
    return { ...updatedMemory }
  }

  const memory: LongTermMemory = {
    id: randomUUID(),
    content: normalizedInput.content,
    type: normalizedInput.type,
    importance: normalizedInput.importance,
    confidence: normalizedInput.confidence,
    createdAt: now,
    updatedAt: now,
    lastReferencedAt: now
  }

  memories.push(memory)
  saveMemories(memories)
  return { ...memory }
}

export function deleteMemory(id: string): boolean {
  const normalizedId = normalizeText(id)
  if (!normalizedId) return false

  const memories = loadMemories()
  const nextMemories = memories.filter((memory) => memory.id !== normalizedId)
  if (nextMemories.length === memories.length) return false

  saveMemories(nextMemories)
  return true
}

export function clearMemories(): void {
  saveMemories([])
}

export function markMemoriesReferenced(ids: string[]): void {
  const normalizedIds = new Set(ids.map(normalizeText).filter((id): id is string => Boolean(id)))
  if (normalizedIds.size === 0) return

  const memories = loadMemories()
  const now = new Date().toISOString()
  let hasChange = false

  const nextMemories = memories.map((memory) => {
    if (!normalizedIds.has(memory.id)) return memory

    hasChange = true
    return {
      ...memory,
      lastReferencedAt: now
    }
  })

  if (hasChange) {
    saveMemories(nextMemories)
  }
}

function loadMemories(): LongTermMemory[] {
  const filePath = getMemoryPath()
  if (!existsSync(filePath)) return []

  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!isRecord(value) || !Array.isArray(value.memories)) return []

    return value.memories
      .map(normalizeStoredMemory)
      .filter((memory): memory is LongTermMemory => Boolean(memory))
  } catch {
    return []
  }
}

function saveMemories(memories: LongTermMemory[]): void {
  const filePath = getMemoryPath()
  const payload: MemoryFilePayload = {
    version: MEMORY_FILE_VERSION,
    memories: memories
      .map(normalizeStoredMemory)
      .filter((memory): memory is LongTermMemory => Boolean(memory))
      .sort(compareMemoriesForDisplay)
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

function getMemoryPath(): string {
  return join(app.getPath('userData'), MEMORY_FILE)
}

function normalizeMemoryInput(input: LongTermMemoryInput): LongTermMemoryInput {
  const content = normalizeMemoryContent(input.content)
  if (!content) {
    throw new Error('Memory content cannot be empty.')
  }

  if (!isMemoryType(input.type)) {
    throw new Error('Memory type is invalid.')
  }

  return {
    content,
    type: input.type,
    importance: normalizeImportance(input.importance),
    confidence: normalizeConfidence(input.confidence)
  }
}

function normalizeStoredMemory(value: unknown): LongTermMemory | undefined {
  if (!isRecord(value)) return undefined

  const id = normalizeText(value.id)
  const content = normalizeMemoryContent(value.content)
  const type = value.type
  const createdAt = normalizeIsoDate(value.createdAt)
  const updatedAt = normalizeIsoDate(value.updatedAt)
  const lastReferencedAt = normalizeIsoDate(value.lastReferencedAt)

  if (!id || !content || !isMemoryType(type) || !createdAt || !updatedAt || !lastReferencedAt) {
    return undefined
  }

  return {
    id,
    content,
    type,
    importance: normalizeImportance(value.importance),
    confidence: normalizeConfidence(value.confidence),
    createdAt,
    updatedAt,
    lastReferencedAt
  }
}

function normalizeMemoryContent(content: unknown): string | undefined {
  const normalizedContent = normalizeText(content)?.replace(/\s+/g, ' ')
  if (!normalizedContent || normalizedContent.length > 120) return undefined

  return normalizedContent
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

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined

  return new Date(timestamp).toISOString()
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit) || limit <= 0) return undefined

  return Math.floor(limit)
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function normalizeComparableText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function compareMemoriesForPrompt(first: LongTermMemory, second: LongTermMemory): number {
  const importanceDifference = second.importance - first.importance
  if (importanceDifference !== 0) return importanceDifference

  return Date.parse(second.updatedAt) - Date.parse(first.updatedAt)
}

function compareMemoriesForDisplay(first: LongTermMemory, second: LongTermMemory): number {
  return Date.parse(second.updatedAt) - Date.parse(first.updatedAt)
}

function isMemoryType(type: unknown): type is LongTermMemoryType {
  return (
    type === 'fact' ||
    type === 'preference' ||
    type === 'project' ||
    type === 'emotion' ||
    type === 'todo'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
