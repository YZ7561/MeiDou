import {
  addChunks,
  addDocument,
  deleteDocument,
  getDocument,
  listAllChunks,
  listDocuments,
  updateDocumentIndexingStatus
} from '../storage/ragStore'
import type { RagChunkInput, RagChunkMetadata, RagDocumentIndexingStatus } from '../storage/ragStore'
import { chunkText } from './chunker'
import { loadRagDocument } from './documentLoader'
import { embedText, embedTexts } from './ragEmbeddingProvider'
import { cosineSimilarity } from './vectorSimilarity'

const MAX_RAG_DOCUMENT_CHUNKS = 500

export interface RagImportResult {
  documentId: string
  name: string
  chunkCount: number
  indexingStatus: RagDocumentIndexingStatus
}

export interface RagRetrievalOptions {
  topK?: number
}

export interface RagRetrievedChunk {
  content: string
  score: number
  documentName: string
  chunkIndex: number
  metadata: RagChunkMetadata
}

export async function importDocument(filePath: string): Promise<RagImportResult> {
  const loadedDocument = await loadRagDocument(filePath)
  const textChunks = chunkText(loadedDocument.content)
  if (textChunks.length > MAX_RAG_DOCUMENT_CHUNKS) {
    throw new Error(
      `RAG document produced too many chunks. Maximum supported chunks is ${MAX_RAG_DOCUMENT_CHUNKS}. Please split the document.`
    )
  }

  const document = addDocument({
    name: loadedDocument.name,
    path: loadedDocument.path,
    type: loadedDocument.type,
    indexingStatus: 'pending'
  })

  try {
    const embeddingResult = await createChunkEmbeddings(textChunks.map((chunk) => chunk.content))
    const chunkInputs: RagChunkInput[] = textChunks.map((chunk, index) => ({
      content: chunk.content,
      index: chunk.index,
      metadata: chunk.metadata,
      ...(embeddingResult.embeddings[index] ? { embedding: embeddingResult.embeddings[index] } : {})
    }))

    if (chunkInputs.length > 0) {
      addChunks(document.id, chunkInputs)
    }

    const indexingStatus = resolveIndexingStatus(chunkInputs.length, embeddingResult.embeddedCount)
    updateDocumentIndexingStatus(
      document.id,
      indexingStatus,
      indexingStatus === 'ready' ? undefined : embeddingResult.errorMessage
    )
  } catch (error) {
    deleteDocument(document.id)
    throw error
  }

  const savedDocument = getDocument(document.id)

  return {
    documentId: document.id,
    name: document.name,
    chunkCount: savedDocument?.chunkCount ?? 0,
    indexingStatus: savedDocument?.indexingStatus ?? 'failed'
  }
}

export async function retrieveRelevantChunks(
  query: string,
  options: RagRetrievalOptions = {}
): Promise<RagRetrievedChunk[]> {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return []

  const queryEmbedding = await embedText(normalizedQuery)
  const topK = normalizeTopK(options.topK)
  const documentsById = new Map(listDocuments().map((document) => [document.id, document]))

  return listAllChunks()
    .map((chunk) => {
      const document = documentsById.get(chunk.documentId)
      if (!document || !chunk.embedding || chunk.embedding.length !== queryEmbedding.length) {
        return undefined
      }

      return {
        content: chunk.content,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        documentName: document.name,
        chunkIndex: chunk.index,
        metadata: chunk.metadata
      }
    })
    .filter((chunk): chunk is RagRetrievedChunk => Boolean(chunk))
    .sort(compareRetrievedChunks)
    .slice(0, topK)
}

interface ChunkEmbeddingResult {
  embeddings: Array<number[] | undefined>
  embeddedCount: number
  errorMessage?: string
}

async function createChunkEmbeddings(contents: string[]): Promise<ChunkEmbeddingResult> {
  if (contents.length === 0) {
    return {
      embeddings: [],
      embeddedCount: 0
    }
  }

  try {
    const embeddings = await embedTexts(contents)

    return {
      embeddings,
      embeddedCount: embeddings.length
    }
  } catch (error) {
    return createPartialChunkEmbeddings(contents, error)
  }
}

async function createPartialChunkEmbeddings(
  contents: string[],
  initialError: unknown
): Promise<ChunkEmbeddingResult> {
  const embeddings: Array<number[] | undefined> = []
  let errorMessage = getErrorMessage(initialError)

  for (const content of contents) {
    try {
      embeddings.push(await embedText(content))
    } catch (error) {
      embeddings.push(undefined)
      errorMessage = getErrorMessage(error)
    }
  }

  return {
    embeddings,
    embeddedCount: embeddings.filter((embedding): embedding is number[] => Boolean(embedding))
      .length,
    errorMessage
  }
}

function resolveIndexingStatus(
  chunkCount: number,
  embeddedCount: number
): RagDocumentIndexingStatus {
  if (chunkCount === 0 || embeddedCount === chunkCount) return 'ready'
  if (embeddedCount > 0) return 'partial'

  return 'failed'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeQuery(query: unknown): string | undefined {
  if (typeof query !== 'string') return undefined

  const normalizedQuery = query.trim()
  return normalizedQuery || undefined
}

function normalizeTopK(topK: unknown): number {
  const value = typeof topK === 'number' ? topK : Number(topK)
  if (!Number.isFinite(value) || value <= 0) return 5

  return Math.floor(value)
}

function compareRetrievedChunks(first: RagRetrievedChunk, second: RagRetrievedChunk): number {
  const scoreDifference = second.score - first.score
  if (scoreDifference !== 0) return scoreDifference

  const documentNameComparison = first.documentName.localeCompare(second.documentName)
  if (documentNameComparison !== 0) return documentNameComparison

  return first.chunkIndex - second.chunkIndex
}
