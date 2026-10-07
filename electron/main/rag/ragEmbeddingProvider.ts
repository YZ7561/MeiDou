import { loadResolvedRagEmbeddingConfig } from '../storage/configStore'
import { loadOnlineApiKey } from '../storage/secretStore'

const OPENAI_EMBEDDINGS_PATH = '/embeddings'
const OLLAMA_EMBED_PATH = '/embed'

type RagEmbeddingErrorCode =
  | 'missing-api-key'
  | 'missing-model'
  | 'invalid-url'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-response'

class RagEmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly code: RagEmbeddingErrorCode,
    readonly status?: number
  ) {
    super(message)
  }
}

export async function embedText(text: string): Promise<number[]> {
  const embeddings = await embedTexts([text])
  const embedding = embeddings[0]

  if (!embedding) {
    throw new RagEmbeddingProviderError('Embedding response was empty.', 'invalid-response')
  }

  return embedding
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const normalizedTexts = texts.map(normalizeText).filter((text): text is string => Boolean(text))
  if (normalizedTexts.length === 0) return []

  const config = loadResolvedRagEmbeddingConfig()

  if (config.provider === 'local') {
    return requestOllamaEmbeddings(
      config.apiBaseUrl,
      config.model,
      config.requestTimeoutMs,
      normalizedTexts
    )
  }

  return requestOnlineEmbeddings(
    config.apiBaseUrl,
    config.model,
    config.requestTimeoutMs,
    normalizedTexts
  )
}

async function requestOnlineEmbeddings(
  apiBaseUrl: string,
  model: string,
  requestTimeoutMs: number,
  texts: string[]
): Promise<number[][]> {
  const apiKey = resolveApiKey()
  if (!apiKey) {
    throw new RagEmbeddingProviderError('Online API key is not configured.', 'missing-api-key')
  }

  const endpoint = resolveOnlineEmbeddingsEndpoint(apiBaseUrl)
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: texts
      })
    },
    requestTimeoutMs
  )

  if (!response.ok) {
    throw new RagEmbeddingProviderError(
      (await readProviderError(response)) ||
        `Online embeddings request failed with status ${response.status}.`,
      'http',
      response.status
    )
  }

  let data: OpenAIEmbeddingsPayload

  try {
    data = (await response.json()) as OpenAIEmbeddingsPayload
  } catch {
    throw new RagEmbeddingProviderError(
      'Online embeddings response was invalid.',
      'invalid-response'
    )
  }

  return extractOpenAIEmbeddings(data, texts.length)
}

async function requestOllamaEmbeddings(
  apiBaseUrl: string,
  model: string | undefined,
  requestTimeoutMs: number,
  texts: string[]
): Promise<number[][]> {
  if (!model) {
    throw new RagEmbeddingProviderError('No Ollama embedding model is selected.', 'missing-model')
  }

  const endpoint = resolveOllamaEmbedEndpoint(apiBaseUrl)
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: texts
      })
    },
    requestTimeoutMs
  )

  if (!response.ok) {
    throw new RagEmbeddingProviderError(
      (await readProviderError(response)) ||
        `Ollama embeddings request failed with status ${response.status}.`,
      'http',
      response.status
    )
  }

  let data: OllamaEmbeddingsPayload

  try {
    data = (await response.json()) as OllamaEmbeddingsPayload
  } catch {
    throw new RagEmbeddingProviderError(
      'Ollama embeddings response was invalid.',
      'invalid-response'
    )
  }

  return extractOllamaEmbeddings(data, texts.length)
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RagEmbeddingProviderError('Embeddings request timed out.', 'timeout')
    }

    throw new RagEmbeddingProviderError(
      `Embeddings network request failed: ${getErrorMessage(error)}`,
      'network'
    )
  } finally {
    clearTimeout(timeout)
  }
}

interface OpenAIEmbeddingsPayload {
  data?: Array<{
    embedding?: unknown
    index?: unknown
  }>
}

interface OllamaEmbeddingsPayload {
  embeddings?: unknown
  embedding?: unknown
}

function resolveApiKey(): string | undefined {
  return (
    loadOnlineApiKey() ??
    normalizeText(process.env.ONLINE_API_KEY) ??
    normalizeText(process.env.OPENAI_API_KEY)
  )
}

function resolveOnlineEmbeddingsEndpoint(apiBaseUrl: string): string {
  const endpoint = normalizeOnlineEmbeddingsEndpoint(apiBaseUrl)

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol.')
    }
  } catch {
    throw new RagEmbeddingProviderError('Online embeddings base URL is invalid.', 'invalid-url')
  }

  return endpoint
}

function normalizeOnlineEmbeddingsEndpoint(apiBaseUrl: string): string {
  const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, '')

  if (normalizedBaseUrl.endsWith('/embeddings')) {
    return normalizedBaseUrl
  }

  if (normalizedBaseUrl.endsWith('/v1')) {
    return `${normalizedBaseUrl}${OPENAI_EMBEDDINGS_PATH}`
  }

  return `${normalizedBaseUrl}/v1${OPENAI_EMBEDDINGS_PATH}`
}

function resolveOllamaEmbedEndpoint(apiBaseUrl: string): string {
  const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, '')

  if (normalizedBaseUrl.endsWith('/embed') || normalizedBaseUrl.endsWith('/embeddings')) {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}${OLLAMA_EMBED_PATH}`
}

function extractOpenAIEmbeddings(data: OpenAIEmbeddingsPayload, expectedCount: number): number[][] {
  if (!Array.isArray(data.data)) {
    throw new RagEmbeddingProviderError(
      'Online embeddings response was invalid.',
      'invalid-response'
    )
  }

  const entries = data.data.map((item, fallbackIndex) => ({
    index: parseIndex(item.index) ?? fallbackIndex,
    embedding: normalizeEmbedding(item.embedding)
  }))

  if (entries.length !== expectedCount || entries.some((entry) => !entry.embedding)) {
    throw new RagEmbeddingProviderError(
      'Online embeddings response did not match the requested input.',
      'invalid-response'
    )
  }

  return entries
    .sort((first, second) => first.index - second.index)
    .map((entry) => entry.embedding as number[])
}

function extractOllamaEmbeddings(data: OllamaEmbeddingsPayload, expectedCount: number): number[][] {
  if (Array.isArray(data.embeddings)) {
    const embeddings = data.embeddings.map(normalizeEmbedding)
    if (embeddings.length === expectedCount && embeddings.every(Boolean)) {
      return embeddings as number[][]
    }
  }

  const singleEmbedding = normalizeEmbedding(data.embedding)
  if (expectedCount === 1 && singleEmbedding) {
    return [singleEmbedding]
  }

  throw new RagEmbeddingProviderError(
    'Ollama embeddings response did not match the requested input.',
    'invalid-response'
  )
}

function normalizeEmbedding(embedding: unknown): number[] | undefined {
  if (!Array.isArray(embedding)) return undefined

  const normalizedEmbedding = embedding.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )

  if (normalizedEmbedding.length !== embedding.length || normalizedEmbedding.length === 0) {
    return undefined
  }

  return normalizedEmbedding
}

function parseIndex(index: unknown): number | undefined {
  const value = typeof index === 'number' ? index : Number(index)
  if (!Number.isFinite(value) || value < 0) return undefined

  return Math.floor(value)
}

async function readProviderError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object') {
      if ('error' in data) {
        const error = (data as { error?: unknown }).error
        if (typeof error === 'string') return error.trim().slice(0, 300)
        if (error && typeof error === 'object' && 'message' in error) {
          const message = (error as { message?: unknown }).message
          return typeof message === 'string' ? message.trim().slice(0, 300) : ''
        }
      }

      if ('message' in data) {
        const message = (data as { message?: unknown }).message
        return typeof message === 'string' ? message.trim().slice(0, 300) : ''
      }
    }
  } catch {
  }

  return ''
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
