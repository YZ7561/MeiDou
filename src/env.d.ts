/// <reference types="vite/client" />

type PetState = 'idle' | 'happy' | 'sleep'
type PetWindowVisibility = 'running' | 'hidden'
type QaProviderName = 'mock' | 'online' | 'local'
type ConversationMessageSource = 'pet' | 'management'
type LongTermMemoryType = 'fact' | 'preference' | 'project' | 'emotion' | 'todo'
type VoiceEngine = 'system'
type RagDocumentIndexingStatus = 'pending' | 'ready' | 'partial' | 'failed'

interface VoiceConfig {
  enabled: boolean
  autoSpeakAnswer: boolean
  engine: VoiceEngine
  rate: number
  volume: number
  pitch: number
  voiceName: string
}

interface ManagementConfig {
  autoShowPetOnLaunch: boolean
  alwaysOnTop: boolean
  defaultQaProvider: QaProviderName
  model: string
  onlineApiBaseUrl: string
  onlineRequestTimeoutMs: number
  hasOnlineApiKey: boolean
  ollamaApiBaseUrl: string
  ollamaModel: string
  longMemoryEnabled: boolean
  ragEnabled: boolean
  voice: VoiceConfig
}

interface ManagementConfigUpdate {
  autoShowPetOnLaunch: boolean
  alwaysOnTop: boolean
  defaultQaProvider: QaProviderName
  model: string
  onlineApiBaseUrl: string
  onlineRequestTimeoutMs: number
  onlineApiKey?: string
  ollamaModel: string
  longMemoryEnabled: boolean
  voice: VoiceConfig
}

interface QaConnectionTestResult {
  success: boolean
  message: string
}

interface OllamaDetectionResult {
  available: boolean
  models: string[]
  message: string
}

interface OllamaQuestionTestResult {
  success: boolean
  message: string
  answer?: string
}

interface QaResponse {
  answer: string
  type: 'mock' | 'online' | 'local'
}

interface MockQaRule {
  keyword: string
  answer: string
}

interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  source: ConversationMessageSource
}

interface LongTermMemory {
  id: string
  content: string
  type: LongTermMemoryType
  importance: number
  confidence: number
  createdAt: string
  updatedAt: string
  lastReferencedAt: string
}

interface RagDocumentSummary {
  id: string
  name: string
  type: 'txt' | 'md' | 'docx' | 'pdf'
  createdAt: string
  updatedAt: string
  chunkCount: number
  indexingStatus: RagDocumentIndexingStatus
  indexingError?: string
}

interface RagImportResult {
  documentId: string
  name: string
  chunkCount: number
  indexingStatus: RagDocumentIndexingStatus
}

interface Window {
  meidouAPI: {
    moveWindowBy(deltaX: number, deltaY: number): Promise<void>
    saveWindowPosition(): Promise<void>
    getPetState(): Promise<PetState>
    savePetState(state: PetState): Promise<void>
    showPetWindow(): Promise<PetWindowVisibility>
    hidePetWindow(): Promise<PetWindowVisibility>
    getPetWindowVisibility(): Promise<PetWindowVisibility>
    onPetWindowVisibilityChanged(callback: (visibility: PetWindowVisibility) => void): () => void
    getManagementConfig(): Promise<ManagementConfig>
    saveManagementConfig(config: ManagementConfigUpdate): Promise<ManagementConfig>
    listConversationMessages(limit?: number): Promise<ConversationMessage[]>
    clearConversationMessages(): Promise<void>
    listMemories(limit?: number): Promise<LongTermMemory[]>
    deleteMemory(id: string): Promise<boolean>
    clearMemories(): Promise<void>
    listRagDocuments(): Promise<RagDocumentSummary[]>
    importRagDocuments(): Promise<RagImportResult[]>
    deleteRagDocument(id: string): Promise<boolean>
    clearRagDocuments(): Promise<void>
    saveRagEnabled(enabled: boolean): Promise<ManagementConfig>
    testOnlineConnection(): Promise<QaConnectionTestResult>
    detectOllama(): Promise<OllamaDetectionResult>
    testOllamaQuestion(question: string): Promise<OllamaQuestionTestResult>
    getMockQaRules(): Promise<MockQaRule[]>
    saveMockQaRules(rules: MockQaRule[]): Promise<MockQaRule[]>
    restoreDefaultMockQaRules(): Promise<MockQaRule[]>
    askQuestion(question: string, source?: ConversationMessageSource): Promise<QaResponse>
    onPetStateChanged(callback: (state: PetState) => void): () => void
  }
}
