import { buildMeiDouMessages } from '../persona/promptBuilder'
import { loadResolvedOnlineQaConfig } from '../../storage/configStore'
import { loadOnlineApiKey } from '../../storage/secretStore'
import type {
  QaConnectionTestResult,
  QaConversationContextMessage,
  QaProvider,
  QaProviderAskOptions,
  QaResponse
} from '../qaTypes'

const CHAT_COMPLETIONS_PATH = '/chat/completions'
const CONNECTION_TEST_QUESTION = '请只回复“连接成功”。'

type OnlineQaErrorCode =
  | 'missing-api-key'
  | 'invalid-url'
  | 'timeout'
  | 'network'
  | 'http'
  | 'empty-response'

class OnlineQaRequestError extends Error {
  constructor(
    message: string,
    readonly code: OnlineQaErrorCode,
    readonly status?: number
  ) {
    super(message)
  }
}

export const onlineQaProvider: QaProvider = {
  async ask(question: string, options?: QaProviderAskOptions): Promise<QaResponse> {
    const answer = await requestOnlineAnswer(
      question,
      options?.conversationContext,
      options?.memoryContext,
      options?.ragContext
    )

    return {
      answer,
      type: 'online'
    }
  }
}

export async function testOnlineQaConnection(): Promise<QaConnectionTestResult> {
  try {
    await requestOnlineAnswer(CONNECTION_TEST_QUESTION)
    return {
      success: true,
      message: '连接成功，在线模型已返回响应。'
    }
  } catch (error) {
    return {
      success: false,
      message: formatConnectionError(error)
    }
  }
}

async function requestOnlineAnswer(
  question: string,
  conversationContext: QaConversationContextMessage[] = [],
  memoryContext: QaProviderAskOptions['memoryContext'] = [],
  ragContext: QaProviderAskOptions['ragContext'] = []
): Promise<string> {
  const apiKey = resolveApiKey()
  if (!apiKey) {
    throw new OnlineQaRequestError('Online API key is not configured.', 'missing-api-key')
  }

  const config = loadResolvedOnlineQaConfig()
  const endpoint = resolveEndpoint(config.apiBaseUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)

  try {
    console.info(
      `[qa] online request: endpoint=${endpoint}, model=${config.model}, timeout=${config.requestTimeoutMs}ms`
    )

    let response: Response

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          messages: buildMeiDouMessages(question, conversationContext, memoryContext, ragContext),
          temperature: 0.7,
          stream: false
        }),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OnlineQaRequestError(
          `Online API request timed out after ${config.requestTimeoutMs}ms.`,
          'timeout'
        )
      }

      throw new OnlineQaRequestError(
        `Online API network request failed: ${getErrorMessage(error)}`,
        'network'
      )
    }

    if (!response.ok) {
      throw new OnlineQaRequestError(
        `Online API request failed with status ${response.status}.`,
        'http',
        response.status
      )
    }

    const data = (await response.json()) as ChatCompletionsPayload
    const answer = extractAnswer(data)

    if (!answer) {
      throw new OnlineQaRequestError('Online API response was empty.', 'empty-response')
    }

    return answer
  } finally {
    clearTimeout(timeout)
  }
}

interface ChatCompletionsPayload {
  choices?: Array<{
    message?: {
      content?: unknown
    }
    text?: unknown
  }>
}

function resolveApiKey(): string | undefined {
  return (
    loadOnlineApiKey() ??
    normalizeText(process.env.ONLINE_API_KEY) ??
    normalizeText(process.env.OPENAI_API_KEY)
  )
}

function resolveEndpoint(apiBaseUrl: string): string {
  const endpoint = normalizeEndpointUrl(apiBaseUrl)

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol.')
    }
  } catch {
    throw new OnlineQaRequestError('Online API base URL is invalid.', 'invalid-url')
  }

  return endpoint
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function normalizeEndpointUrl(url: string): string {
  if (url.includes('/chat/completions')) {
    return url
  }

  return buildChatCompletionsUrl(url)
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  if (normalizedBaseUrl.endsWith('/v1')) {
    return `${normalizedBaseUrl}${CHAT_COMPLETIONS_PATH}`
  }

  return `${normalizedBaseUrl}/v1${CHAT_COMPLETIONS_PATH}`
}

function extractAnswer(data: ChatCompletionsPayload): string {
  const firstChoice = data.choices?.[0]
  const messageContent = firstChoice?.message?.content

  if (typeof messageContent === 'string') {
    return messageContent.trim()
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
      .trim()
  }

  if (typeof firstChoice?.text === 'string') {
    return firstChoice.text.trim()
  }

  return ''
}

function formatConnectionError(error: unknown): string {
  if (!(error instanceof OnlineQaRequestError)) {
    return `连接失败：${getErrorMessage(error)}`
  }

  if (error.code === 'missing-api-key') {
    return '连接失败：尚未配置 API Key。'
  }

  if (error.code === 'invalid-url') {
    return '连接失败：API Base URL 格式无效。'
  }

  if (error.code === 'timeout') {
    return '连接失败：请求超时，请检查网络或增大超时时间。'
  }

  if (error.code === 'network') {
    return '连接失败：无法访问 API 地址，请检查网络和 Base URL。'
  }

  if (error.code === 'empty-response') {
    return '连接失败：服务已响应，但没有返回有效内容。'
  }

  if (error.status === 401 || error.status === 403) {
    return `连接失败：认证失败（HTTP ${error.status}），请检查 API Key。`
  }

  if (error.status === 404) {
    return '连接失败：接口不存在（HTTP 404），请检查 API Base URL。'
  }

  if (error.status === 429) {
    return '连接失败：请求受限（HTTP 429），请检查额度或稍后重试。'
  }

  return `连接失败：服务返回 HTTP ${error.status ?? '错误'}。`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
