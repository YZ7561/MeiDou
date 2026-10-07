export type QaProviderName = 'mock' | 'online' | 'local'

export const DEFAULT_ONLINE_API_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ONLINE_API_MODEL = 'gpt-4o-mini'
export const DEFAULT_ONLINE_REQUEST_TIMEOUT_MS = 60000
export const DEFAULT_OLLAMA_API_BASE_URL = 'http://localhost:11434/api'
export const DEFAULT_OLLAMA_DETECTION_TIMEOUT_MS = 3000
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 120000

export interface OnlineQaConfig {
  apiBaseUrl: string
  requestTimeoutMs: number
}

export interface LocalQaConfig {
  model: string
}

export interface MockQaRule {
  keyword: string
  answer: string
}

export interface QaConfig {
  provider: QaProviderName
  mockRules: MockQaRule[]
  model?: string
  online?: OnlineQaConfig
  local?: LocalQaConfig
}

export interface QaResponse {
  answer: string
  type: QaProviderName
}

export interface QaConversationContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface QaMemoryContextMessage {
  type: 'fact' | 'preference' | 'project' | 'emotion' | 'todo'
  content: string
}

export interface QaRagContextMessage {
  content: string
  documentName: string
  chunkIndex: number
  score: number
  metadata: Record<string, unknown>
}

export interface QaProviderAskOptions {
  model?: string
  conversationContext?: QaConversationContextMessage[]
  memoryContext?: QaMemoryContextMessage[]
  ragContext?: QaRagContextMessage[]
}

export interface QaProvider {
  ask(question: string, options?: QaProviderAskOptions): Promise<QaResponse>
}

export interface QaConnectionTestResult {
  success: boolean
  message: string
}

export interface OllamaDetectionResult {
  available: boolean
  models: string[]
  message: string
}

export interface OllamaQuestionTestResult {
  success: boolean
  message: string
  answer?: string
}
