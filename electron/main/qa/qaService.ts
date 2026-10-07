import { localQaProvider } from './providers/localQaProvider'
import { mockQaProvider } from './providers/mockQaProvider'
import { onlineQaProvider } from './providers/onlineQaProvider'
import { extractMemoriesFromExchange, loadPromptMemoryContext } from '../memory/memoryService'
import { isLongMemoryEnabled, isRagEnabled, loadQaConfig } from '../storage/configStore'
import { appendConversationMessage, listMessages } from '../storage/chatHistoryStore'
import { retrieveRelevantChunks } from '../rag/ragService'
import type { ChatMessageRole, ChatMessageSource } from '../storage/chatHistoryStore'
import type {
  QaConversationContextMessage,
  QaMemoryContextMessage,
  QaProvider,
  QaProviderName,
  QaRagContextMessage,
  QaResponse
} from './qaTypes'

const SHORT_TERM_CONTEXT_MESSAGE_LIMIT = 12
const RAG_CONTEXT_CHUNK_LIMIT = 5

interface ProviderQuestionResult {
  response: QaResponse
  ragContextUsed: boolean
}

export async function askQuestion(
  question: string,
  providerName?: QaProviderName,
  source: ChatMessageSource = 'pet'
): Promise<QaResponse> {
  const normalizedQuestion = question.trim()
  const conversationContext = loadShortTermConversationContext()
  const longMemoryEnabled = isLongMemoryEnabled()
  const memoryContext = longMemoryEnabled ? loadPromptMemoryContext() : []

  if (normalizedQuestion) {
    persistConversationMessage('user', normalizedQuestion, source)
  }

  const result = await askProviderQuestion(
    normalizedQuestion,
    providerName,
    conversationContext,
    memoryContext
  )
  const response = result.response

  if (normalizedQuestion) {
    persistConversationMessage('assistant', response.answer, source)
    if (longMemoryEnabled && !result.ragContextUsed) {
      scheduleMemoryExtraction(normalizedQuestion, response)
    }
  }

  return response
}

async function askProviderQuestion(
  question: string,
  providerName: QaProviderName | undefined,
  conversationContext: QaConversationContextMessage[],
  memoryContext: QaMemoryContextMessage[]
): Promise<ProviderQuestionResult> {
  const qaConfig = loadQaConfig()
  const selectedProviderName = providerName ?? qaConfig.provider
  const provider = getQaProvider(selectedProviderName)

  if (provider === mockQaProvider) {
    return {
      response: await provider.ask(question, { conversationContext, memoryContext }),
      ragContextUsed: false
    }
  }

  const ragContext = await loadRagContext(question)
  const options = { conversationContext, memoryContext, ragContext }

  try {
    const response = await provider.ask(question, options)
    return {
      response: withRagSources(response, ragContext),
      ragContextUsed: ragContext.length > 0
    }
  } catch (error) {
    console.warn(
      `[qa] ${selectedProviderName} provider failed, falling back to mock: ${getErrorMessage(error)}`
    )
    return {
      response: await mockQaProvider.ask(question, { conversationContext, memoryContext }),
      ragContextUsed: false
    }
  }
}

async function loadRagContext(question: string): Promise<QaRagContextMessage[]> {
  if (!question || !isRagEnabled()) return []

  try {
    return (await retrieveRelevantChunks(question, { topK: RAG_CONTEXT_CHUNK_LIMIT })).map(
      (chunk) => ({
        content: chunk.content,
        documentName: chunk.documentName,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
        metadata: chunk.metadata
      })
    )
  } catch (error) {
    console.warn(`[rag] Retrieval skipped: ${getErrorMessage(error)}`)
    return []
  }
}

function withRagSources(response: QaResponse, ragContext: QaRagContextMessage[]): QaResponse {
  if (response.type === 'mock' || ragContext.length === 0 || hasSourceLine(response.answer)) {
    return response
  }

  return {
    ...response,
    answer: `${response.answer.trim()}\n\n来源：${formatRagSources(ragContext)}`
  }
}

function formatRagSources(ragContext: QaRagContextMessage[]): string {
  return [
    ...new Set(
      ragContext.map((chunk) => `${chunk.documentName}（片段 ${chunk.chunkIndex}）`)
    )
  ].join('；')
}

function hasSourceLine(answer: string): boolean {
  return /来源\s*[:：]/.test(answer)
}

function loadShortTermConversationContext(): QaConversationContextMessage[] {
  try {
    return listMessages(SHORT_TERM_CONTEXT_MESSAGE_LIMIT)
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }))
      .filter((message): message is QaConversationContextMessage => Boolean(message.content))
  } catch (error) {
    console.warn(
      `[chat-history] Failed to load short-term conversation context: ${getErrorMessage(error)}`
    )
    return []
  }
}

function getQaProvider(providerName: QaProviderName): QaProvider {
  if (providerName === 'online') {
    return onlineQaProvider
  }

  if (providerName === 'local') {
    return localQaProvider
  }

  return mockQaProvider
}

function persistConversationMessage(
  role: ChatMessageRole,
  content: string,
  source: ChatMessageSource
): void {
  try {
    appendConversationMessage(role, content, source)
  } catch (error) {
    console.warn(
      `[chat-history] Failed to persist ${source} ${role} message: ${getErrorMessage(error)}`
    )
  }
}

function scheduleMemoryExtraction(userMessage: string, response: QaResponse): void {
  if (response.type === 'mock') return

  void extractMemoriesFromExchange({
    userMessage,
    assistantMessage: response.answer,
    providerName: response.type
  })
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
