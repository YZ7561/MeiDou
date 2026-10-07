import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RagDocumentType = 'txt' | 'md' | 'docx' | 'pdf'
export type RagDocumentIndexingStatus = 'pending' | 'ready' | 'partial' | 'failed'
export type RagMetadataValue =
  | string
  | number
  | boolean
  | null
  | RagMetadataValue[]
  | { [key: string]: RagMetadataValue }
export type RagChunkMetadata = Record<string, RagMetadataValue>

export interface RagDocument {
  id: string
  name: string
  path: string
  type: RagDocumentType
  createdAt: string
  updatedAt: string
  chunkCount: number
  indexingStatus: RagDocumentIndexingStatus
  indexingError?: string
}

export interface RagDocumentInput {
  id?: string
  name: string
  path: string
  type: RagDocumentType | `.${RagDocumentType}`
  createdAt?: string
  updatedAt?: string
  indexingStatus?: RagDocumentIndexingStatus
  indexingError?: string
}

export interface RagChunk {
  id: string
  documentId: string
  content: string
  index: number
  metadata: RagChunkMetadata
  embedding?: number[]
}

export interface RagChunkInput {
  id?: string
  documentId?: string
  content: string
  index: number
  metadata?: RagChunkMetadata
  embedding?: number[]
}

interface RagStorePayload {
  version: 1
  documents: RagDocument[]
  chunks: RagChunk[]
}

const RAG_STORE_FILE = 'rag-store.json'
const RAG_STORE_VERSION = 1

export function listDocuments(): RagDocument[] {
  return loadRagStore().documents.map(cloneDocument).sort(compareDocumentsForDisplay)
}

export function getDocument(id: string): RagDocument | undefined {
  const normalizedId = normalizeId(id)
  if (!normalizedId) return undefined

  const document = loadRagStore().documents.find((item) => item.id === normalizedId)
  return document ? cloneDocument(document) : undefined
}

export function addDocument(record: RagDocumentInput): RagDocument {
  const document = normalizeDocumentInput(record)
  const store = loadRagStore()

  if (store.documents.some((item) => item.id === document.id)) {
    throw new Error('RAG document already exists.')
  }

  store.documents.push(document)
  saveRagStore(store)

  return cloneDocument(document)
}

export function deleteDocument(id: string): boolean {
  const normalizedId = normalizeId(id)
  if (!normalizedId) return false

  const store = loadRagStore()
  const nextDocuments = store.documents.filter((document) => document.id !== normalizedId)
  if (nextDocuments.length === store.documents.length) return false

  saveRagStore({
    documents: nextDocuments,
    chunks: store.chunks.filter((chunk) => chunk.documentId !== normalizedId)
  })

  return true
}

export function updateDocumentIndexingStatus(
  id: string,
  indexingStatus: RagDocumentIndexingStatus,
  indexingError?: string
): RagDocument | undefined {
  const normalizedId = normalizeId(id)
  if (!normalizedId) return undefined

  const store = loadRagStore()
  const documentIndex = store.documents.findIndex((document) => document.id === normalizedId)
  if (documentIndex < 0) return undefined

  const normalizedIndexingStatus = normalizeIndexingStatus(indexingStatus)
  if (!normalizedIndexingStatus) {
    throw new Error('RAG document indexing status is invalid.')
  }

  const normalizedIndexingError = normalizeIndexingError(indexingError)
  const updatedDocument: RagDocument = {
    ...store.documents[documentIndex],
    updatedAt: new Date().toISOString(),
    indexingStatus: normalizedIndexingStatus,
    ...(normalizedIndexingError ? { indexingError: normalizedIndexingError } : {})
  }

  if (!normalizedIndexingError && 'indexingError' in updatedDocument) {
    delete updatedDocument.indexingError
  }

  store.documents[documentIndex] = updatedDocument
  saveRagStore(store)

  return cloneDocument(updatedDocument)
}

export function clearDocuments(): void {
  saveRagStore({
    documents: [],
    chunks: []
  })
}

export function addChunks(documentId: string, chunks: RagChunkInput[]): RagChunk[] {
  const normalizedDocumentId = normalizeId(documentId)
  if (!normalizedDocumentId) {
    throw new Error('RAG document id cannot be empty.')
  }

  if (!Array.isArray(chunks) || chunks.length === 0) return []

  const store = loadRagStore()
  const documentIndex = store.documents.findIndex((document) => document.id === normalizedDocumentId)
  if (documentIndex < 0) {
    throw new Error('RAG document does not exist.')
  }

  const existingChunkIds = new Set(store.chunks.map((chunk) => chunk.id))
  const nextChunks = chunks.map((chunk) => normalizeChunkInput(normalizedDocumentId, chunk))
  const nextChunkIds = new Set<string>()

  for (const chunk of nextChunks) {
    if (existingChunkIds.has(chunk.id) || nextChunkIds.has(chunk.id)) {
      throw new Error('RAG chunk already exists.')
    }

    nextChunkIds.add(chunk.id)
  }

  store.chunks.push(...nextChunks)
  store.documents[documentIndex] = {
    ...store.documents[documentIndex],
    updatedAt: new Date().toISOString(),
    chunkCount: store.chunks.filter((chunk) => chunk.documentId === normalizedDocumentId).length
  }

  saveRagStore(store)

  return nextChunks.map(cloneChunk).sort(compareChunksForDisplay)
}

export function getChunksByDocument(documentId: string): RagChunk[] {
  const normalizedDocumentId = normalizeId(documentId)
  if (!normalizedDocumentId) return []

  return loadRagStore()
    .chunks.filter((chunk) => chunk.documentId === normalizedDocumentId)
    .map(cloneChunk)
    .sort(compareChunksForDisplay)
}

export function listAllChunks(): RagChunk[] {
  return loadRagStore().chunks.map(cloneChunk).sort(compareChunksForDisplay)
}

function loadRagStore(): Omit<RagStorePayload, 'version'> {
  const filePath = getRagStorePath()
  if (!existsSync(filePath)) {
    return {
      documents: [],
      chunks: []
    }
  }

  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!isRecord(value)) {
      return {
        documents: [],
        chunks: []
      }
    }

    return normalizeStoredPayload(value)
  } catch {
    return {
      documents: [],
      chunks: []
    }
  }
}

function saveRagStore(store: Omit<RagStorePayload, 'version'>): void {
  const filePath = getRagStorePath()
  const normalizedStore = normalizeStoredPayload(store)
  const payload: RagStorePayload = {
    version: RAG_STORE_VERSION,
    documents: normalizedStore.documents.sort(compareDocumentsForDisplay),
    chunks: normalizedStore.chunks.sort(compareChunksForDisplay)
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

function getRagStorePath(): string {
  return join(app.getPath('userData'), RAG_STORE_FILE)
}

function normalizeStoredPayload(value: Record<string, unknown>): Omit<RagStorePayload, 'version'> {
  const documents = Array.isArray(value.documents)
    ? value.documents
        .map(normalizeStoredDocument)
        .filter((document): document is RagDocument => Boolean(document))
    : []
  const documentIds = new Set(documents.map((document) => document.id))
  const chunks = Array.isArray(value.chunks)
    ? value.chunks
        .map(normalizeStoredChunk)
        .filter((chunk): chunk is RagChunk => Boolean(chunk && documentIds.has(chunk.documentId)))
    : []

  return {
    documents: syncDocumentChunkCounts(documents, chunks),
    chunks
  }
}

function normalizeDocumentInput(record: RagDocumentInput): RagDocument {
  const id = normalizeId(record.id) ?? randomUUID()
  const name = normalizeText(record.name)
  const filePath = normalizeText(record.path)
  const type = normalizeDocumentType(record.type)
  const now = new Date().toISOString()

  if (!name) {
    throw new Error('RAG document name cannot be empty.')
  }

  if (!filePath) {
    throw new Error('RAG document path cannot be empty.')
  }

  if (!type) {
    throw new Error('RAG document type is invalid.')
  }

  return {
    id,
    name,
    path: filePath,
    type,
    createdAt: normalizeIsoDate(record.createdAt) ?? now,
    updatedAt: normalizeIsoDate(record.updatedAt) ?? now,
    chunkCount: 0,
    indexingStatus: normalizeIndexingStatus(record.indexingStatus) ?? 'pending',
    ...(normalizeIndexingError(record.indexingError)
      ? { indexingError: normalizeIndexingError(record.indexingError) }
      : {})
  }
}

function normalizeStoredDocument(value: unknown): RagDocument | undefined {
  if (!isRecord(value)) return undefined

  const id = normalizeId(value.id)
  const name = normalizeText(value.name)
  const filePath = normalizeText(value.path)
  const type = normalizeDocumentType(value.type)
  const createdAt = normalizeIsoDate(value.createdAt)
  const updatedAt = normalizeIsoDate(value.updatedAt)
  const indexingStatus = normalizeIndexingStatus(value.indexingStatus) ?? 'pending'

  if (!id || !name || !filePath || !type || !createdAt || !updatedAt) {
    return undefined
  }

  return {
    id,
    name,
    path: filePath,
    type,
    createdAt,
    updatedAt,
    chunkCount: normalizeChunkCount(value.chunkCount),
    indexingStatus,
    ...(normalizeIndexingError(value.indexingError)
      ? { indexingError: normalizeIndexingError(value.indexingError) }
      : {})
  }
}

function normalizeChunkInput(documentId: string, chunk: RagChunkInput): RagChunk {
  const content = normalizeContent(chunk.content)
  if (!content) {
    throw new Error('RAG chunk content cannot be empty.')
  }

  return {
    id: normalizeId(chunk.id) ?? randomUUID(),
    documentId,
    content,
    index: normalizeChunkIndex(chunk.index),
    metadata: normalizeMetadata(chunk.metadata),
    ...(normalizeEmbedding(chunk.embedding)
      ? { embedding: normalizeEmbedding(chunk.embedding) }
      : {})
  }
}

function normalizeStoredChunk(value: unknown): RagChunk | undefined {
  if (!isRecord(value)) return undefined

  const id = normalizeId(value.id)
  const documentId = normalizeId(value.documentId)
  const content = normalizeContent(value.content)
  const index = parseChunkIndex(value.index)

  if (!id || !documentId || !content || index === undefined) {
    return undefined
  }

  return {
    id,
    documentId,
    content,
    index,
    metadata: normalizeMetadata(value.metadata),
    ...(normalizeEmbedding(value.embedding) ? { embedding: normalizeEmbedding(value.embedding) } : {})
  }
}

function syncDocumentChunkCounts(documents: RagDocument[], chunks: RagChunk[]): RagDocument[] {
  const chunkCounts = chunks.reduce((counts, chunk) => {
    counts.set(chunk.documentId, (counts.get(chunk.documentId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  return documents.map((document) => ({
    ...document,
    chunkCount: chunkCounts.get(document.id) ?? 0
  }))
}

function normalizeMetadata(metadata: unknown): RagChunkMetadata {
  if (!isRecord(metadata)) return {}

  return Object.entries(metadata).reduce<RagChunkMetadata>((result, [key, value]) => {
    const normalizedKey = normalizeText(key)
    const normalizedValue = normalizeMetadataValue(value)
    if (normalizedKey && normalizedValue !== undefined) {
      result[normalizedKey] = normalizedValue
    }

    return result
  }, {})
}

function normalizeMetadataValue(value: unknown): RagMetadataValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined

  if (Array.isArray(value)) {
    return value
      .map(normalizeMetadataValue)
      .filter((item): item is RagMetadataValue => item !== undefined)
  }

  if (isRecord(value)) {
    return Object.entries(value).reduce<Record<string, RagMetadataValue>>((result, [key, item]) => {
      const normalizedKey = normalizeText(key)
      const normalizedItem = normalizeMetadataValue(item)
      if (normalizedKey && normalizedItem !== undefined) {
        result[normalizedKey] = normalizedItem
      }

      return result
    }, {})
  }

  return undefined
}

function normalizeEmbedding(embedding: unknown): number[] | undefined {
  if (!Array.isArray(embedding)) return undefined

  const normalizedEmbedding = embedding.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  if (normalizedEmbedding.length !== embedding.length) return undefined

  return normalizedEmbedding
}

function normalizeDocumentType(type: unknown): RagDocumentType | undefined {
  const normalizedType = normalizeText(type)?.replace(/^\./, '').toLocaleLowerCase()
  if (
    normalizedType === 'txt' ||
    normalizedType === 'md' ||
    normalizedType === 'docx' ||
    normalizedType === 'pdf'
  ) {
    return normalizedType
  }

  return undefined
}

function normalizeIndexingStatus(status: unknown): RagDocumentIndexingStatus | undefined {
  if (
    status === 'pending' ||
    status === 'ready' ||
    status === 'partial' ||
    status === 'failed'
  ) {
    return status
  }

  return undefined
}

function normalizeIndexingError(error: unknown): string | undefined {
  if (typeof error !== 'string') return undefined

  const normalizedError = error.trim()
  return normalizedError ? normalizedError.slice(0, 500) : undefined
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined

  return new Date(timestamp).toISOString()
}

function normalizeChunkIndex(index: unknown): number {
  const value = parseChunkIndex(index)
  if (value === undefined) {
    throw new Error('RAG chunk index is invalid.')
  }

  return value
}

function parseChunkIndex(index: unknown): number | undefined {
  const value = typeof index === 'number' ? index : Number(index)
  if (!Number.isFinite(value) || value < 0) return undefined

  return Math.floor(value)
}

function normalizeChunkCount(chunkCount: unknown): number {
  const value = typeof chunkCount === 'number' ? chunkCount : Number(chunkCount)
  if (!Number.isFinite(value) || value < 0) return 0

  return Math.floor(value)
}

function normalizeId(id: unknown): string | undefined {
  return normalizeText(id)
}

function normalizeContent(content: unknown): string | undefined {
  return normalizeText(content)
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function cloneDocument(document: RagDocument): RagDocument {
  return { ...document }
}

function cloneChunk(chunk: RagChunk): RagChunk {
  return {
    ...chunk,
    metadata: normalizeMetadata(chunk.metadata),
    ...(chunk.embedding ? { embedding: [...chunk.embedding] } : {})
  }
}

function compareDocumentsForDisplay(first: RagDocument, second: RagDocument): number {
  return Date.parse(second.updatedAt) - Date.parse(first.updatedAt)
}

function compareChunksForDisplay(first: RagChunk, second: RagChunk): number {
  if (first.documentId !== second.documentId) {
    return first.documentId.localeCompare(second.documentId)
  }

  return first.index - second.index
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
