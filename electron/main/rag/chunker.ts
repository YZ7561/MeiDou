import type { RagChunkMetadata } from '../storage/ragStore'

export interface RagTextChunk {
  content: string
  index: number
  metadata: RagChunkMetadata
}

export interface ChunkTextOptions {
  chunkSize?: number
  chunkOverlap?: number
}

const DEFAULT_CHUNK_SIZE = 1000
const MIN_CHUNK_SIZE = 800
const MAX_CHUNK_SIZE = 1200
const DEFAULT_CHUNK_OVERLAP = 150
const MIN_CHUNK_OVERLAP = 100
const MAX_CHUNK_OVERLAP = 200

export function chunkText(content: string, options: ChunkTextOptions = {}): RagTextChunk[] {
  const text = normalizeTextContent(content)
  if (!text) return []

  const chunkSize = normalizeChunkSize(options.chunkSize)
  const chunkOverlap = normalizeChunkOverlap(options.chunkOverlap, chunkSize)
  const chunks: RagTextChunk[] = []
  let startOffset = 0

  while (startOffset < text.length) {
    const endOffset = Math.min(startOffset + chunkSize, text.length)
    const chunkContent = text.slice(startOffset, endOffset).trim()

    if (chunkContent) {
      chunks.push({
        content: chunkContent,
        index: chunks.length,
        metadata: {
          startOffset,
          endOffset
        }
      })
    }

    if (endOffset >= text.length) break

    const nextStartOffset = endOffset - chunkOverlap
    startOffset = nextStartOffset > startOffset ? nextStartOffset : endOffset
  }

  return chunks
}

function normalizeTextContent(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined

  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  return normalizedContent || undefined
}

function normalizeChunkSize(chunkSize: unknown): number {
  const value = typeof chunkSize === 'number' ? chunkSize : Number(chunkSize)
  if (!Number.isFinite(value)) return DEFAULT_CHUNK_SIZE

  return Math.min(Math.max(Math.floor(value), MIN_CHUNK_SIZE), MAX_CHUNK_SIZE)
}

function normalizeChunkOverlap(chunkOverlap: unknown, chunkSize: number): number {
  const value = typeof chunkOverlap === 'number' ? chunkOverlap : Number(chunkOverlap)
  const normalizedValue = Number.isFinite(value) ? Math.floor(value) : DEFAULT_CHUNK_OVERLAP
  const boundedValue = Math.min(Math.max(normalizedValue, MIN_CHUNK_OVERLAP), MAX_CHUNK_OVERLAP)

  return Math.min(boundedValue, Math.max(chunkSize - 1, 0))
}
