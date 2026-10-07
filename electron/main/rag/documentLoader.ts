import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import mammoth from 'mammoth'
import { getDocument } from 'pdfjs-dist/build/pdf.js'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.js'
import type { RagDocumentType } from '../storage/ragStore'

const MAX_RAG_DOCUMENT_SIZE_MB = 50
const MAX_RAG_DOCUMENT_SIZE_BYTES = MAX_RAG_DOCUMENT_SIZE_MB * 1024 * 1024

export interface LoadedRagDocument {
  name: string
  path: string
  type: RagDocumentType
  content: string
}

interface PdfTextItem {
  str?: unknown
  transform?: unknown
}

interface PdfPageData {
  getTextContent(options?: {
    normalizeWhitespace: boolean
    disableCombineTextItems: boolean
  }): Promise<{ items: PdfTextItem[] }>
  cleanup(): void
}

interface PdfjsWorkerGlobal {
  pdfjsWorker?: {
    WorkerMessageHandler: unknown
  }
}

export async function loadRagDocument(filePath: string): Promise<LoadedRagDocument> {
  const resolvedPath = normalizeFilePath(filePath)
  if (!resolvedPath) {
    throw new Error('RAG document path cannot be empty.')
  }

  const type = resolveDocumentType(resolvedPath)
  if (!type) {
    throw new Error('RAG document type is not supported.')
  }

  if (!existsSync(resolvedPath)) {
    throw new Error('RAG document does not exist.')
  }

  const stats = statSync(resolvedPath)
  if (!stats.isFile()) {
    throw new Error('RAG document path must point to a file.')
  }

  if (stats.size > MAX_RAG_DOCUMENT_SIZE_BYTES) {
    throw new Error(
      `RAG document is too large. Maximum supported size is ${MAX_RAG_DOCUMENT_SIZE_MB} MB.`
    )
  }

  return {
    name: basename(resolvedPath),
    path: resolvedPath,
    type,
    content: await readDocumentContent(resolvedPath, type)
  }
}

async function readDocumentContent(filePath: string, type: RagDocumentType): Promise<string> {
  if (type === 'docx') {
    return extractDocxText(filePath)
  }

  if (type === 'pdf') {
    return extractPdfText(filePath)
  }

  return stripUtf8Bom(readFileSync(filePath, 'utf-8'))
}

async function extractDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })

  logMammothMessages(filePath, result.messages)

  if (!result.value.trim()) {
    throw new Error('DOCX document does not contain extractable text.')
  }

  return result.value
}

async function extractPdfText(filePath: string): Promise<string> {
  let document: { numPages: number; getPage(pageNumber: number): Promise<PdfPageData>; destroy(): void }

  try {
    registerPdfWorker()
    const loadingTask = getDocument({
      data: new Uint8Array(readFileSync(filePath)),
      disableFontFace: true,
      useSystemFonts: true
    })
    document = await loadingTask.promise
  } catch (error) {
    logPdfParseError(filePath, error)
    throw new Error('PDF document could not be parsed.')
  }

  try {
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const text = normalizeExtractedText(await extractPdfPageText(page))
      page.cleanup()

      if (text) {
        pages.push(`[Page ${pageNumber}]\n${text}`)
      }
    }

    const content = normalizeExtractedText(pages.join('\n\n'))
    if (!content) {
      throw new Error('PDF document does not contain extractable text.')
    }

    return content
  } catch (error) {
    if (error instanceof Error && error.message === 'PDF document does not contain extractable text.') {
      throw error
    }

    logPdfParseError(filePath, error)
    throw new Error('PDF document could not be parsed.')
  } finally {
    document.destroy()
  }
}

function registerPdfWorker(): void {
  const pdfjsGlobal = globalThis as typeof globalThis & PdfjsWorkerGlobal
  if (!pdfjsGlobal.pdfjsWorker) {
    pdfjsGlobal.pdfjsWorker = {
      WorkerMessageHandler
    }
  }
}

async function extractPdfPageText(pageData: PdfPageData): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  })
  let lastY: number | undefined
  let text = ''

  for (const item of textContent.items) {
    const value = typeof item.str === 'string' ? item.str : ''
    if (!value) continue

    const y = getPdfTextItemY(item)
    if (lastY === undefined || y === undefined || y === lastY) {
      text += value
    } else {
      text += `\n${value}`
    }

    lastY = y
  }

  return text
}

function logMammothMessages(
  filePath: string,
  messages: Array<{ type: string; message: string }>
): void {
  for (const message of messages) {
    console.warn(`[rag] DOCX parse ${message.type} for ${basename(filePath)}: ${message.message}`)
  }
}

function logPdfParseError(filePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[rag] PDF parse failed for ${basename(filePath)}: ${message}`)
}

function normalizeFilePath(filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined

  const normalizedPath = filePath.trim()
  return normalizedPath ? resolve(normalizedPath) : undefined
}

function resolveDocumentType(filePath: string): RagDocumentType | undefined {
  const extension = extname(filePath).toLocaleLowerCase()
  if (extension === '.txt') return 'txt'
  if (extension === '.md') return 'md'
  if (extension === '.docx') return 'docx'
  if (extension === '.pdf') return 'pdf'

  return undefined
}

function stripUtf8Bom(content: string): string {
  return content.replace(/^\uFEFF/, '')
}

function normalizeExtractedText(content: string): string {
  return stripUtf8Bom(content)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getPdfTextItemY(item: PdfTextItem): number | undefined {
  if (!Array.isArray(item.transform)) return undefined

  const y = item.transform[5]
  return typeof y === 'number' ? y : undefined
}
