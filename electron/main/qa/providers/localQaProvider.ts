import { buildMeiDouMessages } from '../persona/promptBuilder'
import { loadResolvedOllamaQaConfig } from '../../storage/configStore'
import {
  DEFAULT_OLLAMA_DETECTION_TIMEOUT_MS,
  DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
} from '../qaTypes'
import type {
  OllamaDetectionResult,
  OllamaQuestionTestResult,
  QaConversationContextMessage,
  QaProvider,
  QaProviderAskOptions,
  QaResponse
} from '../qaTypes'

type OllamaErrorCode = 'unavailable' | 'timeout' | 'http' | 'invalid-response' | 'missing-model'

class OllamaRequestError extends Error {
  constructor(
    message: string,
    readonly code: OllamaErrorCode,
    readonly status?: number
  ) {
    super(message)
  }
}

export const localQaProvider: QaProvider = {
  async ask(question: string, options?: QaProviderAskOptions): Promise<QaResponse> {
    const answer = await requestOllamaAnswer(
      question,
      options?.model,
      options?.conversationContext,
      options?.memoryContext,
      options?.ragContext
    )

    return {
      answer,
      type: 'local'
    }
  }
}

export async function detectOllama(): Promise<OllamaDetectionResult> {
  try {
    const models = await fetchOllamaModels()

    return {
      available: true,
      models,
      message:
        models.length > 0
          ? `Ollama 服务运行中，检测到 ${models.length} 个模型。`
          : 'Ollama 服务运行中，但尚未安装可用模型。'
    }
  } catch (error) {
    return {
      available: false,
      models: [],
      message: formatOllamaError(error)
    }
  }
}

export async function testOllamaQuestion(question: string): Promise<OllamaQuestionTestResult> {
  const normalizedQuestion = question.trim()
  if (!normalizedQuestion) {
    return {
      success: false,
      message: '测试问题不能为空。'
    }
  }

  try {
    const answer = await requestOllamaAnswer(normalizedQuestion)
    return {
      success: true,
      message: 'Ollama 问答测试成功。',
      answer
    }
  } catch (error) {
    return {
      success: false,
      message: formatOllamaError(error)
    }
  }
}

async function fetchOllamaModels(): Promise<string[]> {
  const { apiBaseUrl } = loadResolvedOllamaQaConfig()
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/tags`,
    { method: 'GET' },
    DEFAULT_OLLAMA_DETECTION_TIMEOUT_MS
  )

  if (!response.ok) {
    throw new OllamaRequestError(
      `Ollama model list request failed with status ${response.status}.`,
      'http',
      response.status
    )
  }

  let data: OllamaTagsPayload

  try {
    data = (await response.json()) as OllamaTagsPayload
  } catch {
    throw new OllamaRequestError('Ollama model list response was invalid.', 'invalid-response')
  }

  if (!Array.isArray(data.models)) {
    throw new OllamaRequestError('Ollama model list response was invalid.', 'invalid-response')
  }

  return [...new Set(data.models.map(getOllamaModelName).filter(isNonEmptyString))].sort()
}

async function requestOllamaAnswer(
  question: string,
  requestedModel?: string,
  conversationContext: QaConversationContextMessage[] = [],
  memoryContext: QaProviderAskOptions['memoryContext'] = [],
  ragContext: QaProviderAskOptions['ragContext'] = []
): Promise<string> {
  const config = loadResolvedOllamaQaConfig()
  const model = requestedModel?.trim() || config.model

  if (!model) {
    throw new OllamaRequestError('No Ollama model is selected.', 'missing-model')
  }

  const response = await fetchWithTimeout(
    `${config.apiBaseUrl}/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: buildMeiDouMessages(question, conversationContext, memoryContext, ragContext),
        stream: false
      })
    },
    DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
  )

  if (!response.ok) {
    const detail = await readOllamaError(response)
    throw new OllamaRequestError(
      detail || `Ollama chat request failed with status ${response.status}.`,
      'http',
      response.status
    )
  }

  let data: OllamaChatPayload

  try {
    data = (await response.json()) as OllamaChatPayload
  } catch {
    throw new OllamaRequestError('Ollama chat response was invalid.', 'invalid-response')
  }

  const answer = typeof data.message?.content === 'string' ? data.message.content.trim() : ''
  if (!answer) {
    throw new OllamaRequestError('Ollama chat response was empty.', 'invalid-response')
  }

  return answer
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
  } catch {
    if (controller.signal.aborted) {
      throw new OllamaRequestError('Ollama request timed out.', 'timeout')
    }

    throw new OllamaRequestError('Ollama service is unavailable.', 'unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

interface OllamaTagsPayload {
  models?: OllamaModelPayload[]
}

interface OllamaModelPayload {
  name?: unknown
  model?: unknown
}

interface OllamaChatPayload {
  message?: {
    content?: unknown
  }
}

function getOllamaModelName(model: OllamaModelPayload): string {
  if (typeof model.model === 'string') return model.model.trim()
  if (typeof model.name === 'string') return model.name.trim()
  return ''
}

function isNonEmptyString(value: string): value is string {
  return Boolean(value)
}

async function readOllamaError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'error' in data) {
      const error = (data as { error?: unknown }).error
      return typeof error === 'string' ? error.trim().slice(0, 300) : ''
    }
  } catch {
  }

  return ''
}

function formatOllamaError(error: unknown): string {
  if (!(error instanceof OllamaRequestError)) {
    return 'Ollama 检测失败，请稍后重试。'
  }

  if (error.code === 'unavailable') {
    return '未检测到 Ollama 服务，请确认 Ollama 已安装并正在运行。'
  }

  if (error.code === 'timeout') {
    return 'Ollama 请求超时，请确认服务正在运行且模型可以响应。'
  }

  if (error.code === 'missing-model') {
    return '尚未选择 Ollama 模型，请先检测并选择一个模型。'
  }

  if (error.code === 'invalid-response') {
    return 'Ollama 返回了无法识别的响应。'
  }

  if (error.status === 404) {
    return 'Ollama 未找到所选模型，请重新检测模型列表。'
  }

  return `Ollama 服务返回错误（HTTP ${error.status ?? '未知'}）。`
}
