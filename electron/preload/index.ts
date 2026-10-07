import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipcChannels'

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

const meidouAPI = {
  moveWindowBy(deltaX: number, deltaY: number): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MOVE_BY, deltaX, deltaY)
  },
  saveWindowPosition(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SAVE_POSITION)
  },
  getPetState(): Promise<PetState> {
    return ipcRenderer.invoke(IPC_CHANNELS.PET_GET_STATE)
  },
  savePetState(state: PetState): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.PET_SAVE_STATE, state)
  },
  showPetWindow(): Promise<PetWindowVisibility> {
    return ipcRenderer.invoke(IPC_CHANNELS.PET_WINDOW_SHOW)
  },
  hidePetWindow(): Promise<PetWindowVisibility> {
    return ipcRenderer.invoke(IPC_CHANNELS.PET_WINDOW_HIDE)
  },
  getPetWindowVisibility(): Promise<PetWindowVisibility> {
    return ipcRenderer.invoke(IPC_CHANNELS.PET_WINDOW_GET_VISIBILITY)
  },
  onPetWindowVisibilityChanged(callback: (visibility: PetWindowVisibility) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, visibility: PetWindowVisibility): void => {
      callback(visibility)
    }

    ipcRenderer.on(IPC_CHANNELS.PET_WINDOW_VISIBILITY_CHANGED, listener)

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PET_WINDOW_VISIBILITY_CHANGED, listener)
    }
  },
  getManagementConfig(): Promise<ManagementConfig> {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_CONFIG_GET)
  },
  saveManagementConfig(config: ManagementConfigUpdate): Promise<ManagementConfig> {
    return ipcRenderer.invoke(IPC_CHANNELS.MANAGEMENT_CONFIG_SAVE, config)
  },
  listConversationMessages(limit?: number): Promise<ConversationMessage[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONVERSATION_LIST, limit)
  },
  clearConversationMessages(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.CONVERSATION_CLEAR)
  },
  listMemories(limit?: number): Promise<LongTermMemory[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_LIST, limit)
  },
  deleteMemory(id: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, id)
  },
  clearMemories(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_CLEAR)
  },
  listRagDocuments(): Promise<RagDocumentSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_DOCUMENTS_LIST)
  },
  importRagDocuments(): Promise<RagImportResult[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_DOCUMENTS_IMPORT)
  },
  deleteRagDocument(id: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_DOCUMENT_DELETE, id)
  },
  clearRagDocuments(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_DOCUMENTS_CLEAR)
  },
  saveRagEnabled(enabled: boolean): Promise<ManagementConfig> {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_ENABLED_SAVE, enabled)
  },
  testOnlineConnection(): Promise<QaConnectionTestResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_TEST_ONLINE_CONNECTION)
  },
  detectOllama(): Promise<OllamaDetectionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_OLLAMA_DETECT)
  },
  testOllamaQuestion(question: string): Promise<OllamaQuestionTestResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_OLLAMA_TEST_QUESTION, question)
  },
  getMockQaRules(): Promise<MockQaRule[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_MOCK_RULES_GET)
  },
  saveMockQaRules(rules: MockQaRule[]): Promise<MockQaRule[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_MOCK_RULES_SAVE, rules)
  },
  restoreDefaultMockQaRules(): Promise<MockQaRule[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_MOCK_RULES_RESTORE_DEFAULTS)
  },
  askQuestion(question: string, source: ConversationMessageSource = 'pet'): Promise<QaResponse> {
    return ipcRenderer.invoke(IPC_CHANNELS.QA_ASK, question, source)
  },
  onPetStateChanged(callback: (state: PetState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: PetState): void => {
      callback(state)
    }

    ipcRenderer.on(IPC_CHANNELS.PET_SET_STATE, listener)

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PET_SET_STATE, listener)
    }
  }
}

contextBridge.exposeInMainWorld('meidouAPI', meidouAPI)
