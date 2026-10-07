import { app, dialog, ipcMain } from 'electron'
import {
  allowPetWindowClose,
  applyPetWindowAlwaysOnTop,
  createPetWindow,
  getPetWindow,
  getPetWindowVisibility,
  hidePetWindow,
  savePetWindowPosition,
  showPetWindow
} from './window/petWindow'
import { createManagementWindow, showManagementWindow } from './window/managementWindow'
import { createTrayMenu, destroyTrayMenu, refreshTrayMenu } from './tray/trayMenu'
import { createApplicationMenu } from './applicationMenu'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import { askQuestion } from './qa/qaService'
import { testOnlineQaConnection } from './qa/providers/onlineQaProvider'
import { detectOllama, testOllamaQuestion } from './qa/providers/localQaProvider'
import {
  loadConfig,
  loadManagementConfig,
  loadMockQaRules,
  PetState,
  restoreDefaultMockQaRules,
  saveManagementConfig,
  saveMockQaRules,
  saveRagEnabled,
  savePetState
} from './storage/configStore'
import { clearMessages, listMessages } from './storage/chatHistoryStore'
import type { ChatMessageSource } from './storage/chatHistoryStore'
import { clearMemories, deleteMemory, listMemories } from './storage/memoryStore'
import { saveOnlineApiKey } from './storage/secretStore'
import {
  clearDocuments as clearRagDocuments,
  deleteDocument as deleteRagDocument,
  listDocuments as listRagDocuments
} from './storage/ragStore'
import type { RagDocument } from './storage/ragStore'
import { importDocument as importRagDocument } from './rag/ragService'

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
}

app.whenReady().then(() => {
  const config = loadConfig()

  createApplicationMenu()
  createManagementWindow()
  if (config.autoShowPetOnLaunch) {
    createPetWindow()
  }
  createTrayMenu()
  registerIpcHandlers()
})

app.on('second-instance', () => {
  showManagementWindow()

  if (loadConfig().autoShowPetOnLaunch) {
    showPetWindow()
  }

  const petWindow = getPetWindow()
  if (!petWindow) return

  if (petWindow.isMinimized()) {
    petWindow.restore()
  }

  petWindow.focus()
})

app.on('before-quit', () => {
  allowPetWindowClose()
  savePetWindowPosition()
  destroyTrayMenu()
})

app.on('window-all-closed', () => {
  // Keep the tray process alive when the pet window is hidden or closed.
})

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_MOVE_BY, (_event, deltaX: number, deltaY: number) => {
    const petWindow = getPetWindow()
    if (!petWindow) return
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return

    const [x, y] = petWindow.getPosition()
    petWindow.setPosition(Math.round(x + deltaX), Math.round(y + deltaY), false)
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_SAVE_POSITION, () => {
    savePetWindowPosition()
  })

  ipcMain.handle(IPC_CHANNELS.PET_GET_STATE, () => {
    return loadConfig().petState
  })

  ipcMain.handle(IPC_CHANNELS.PET_SAVE_STATE, (_event, state: PetState) => {
    if (state !== 'idle' && state !== 'happy' && state !== 'sleep') return

    savePetState(state)
  })

  ipcMain.handle(IPC_CHANNELS.PET_WINDOW_SHOW, () => {
    showPetWindow()
    return getPetWindowVisibility()
  })

  ipcMain.handle(IPC_CHANNELS.PET_WINDOW_HIDE, () => {
    hidePetWindow()
    return getPetWindowVisibility()
  })

  ipcMain.handle(IPC_CHANNELS.PET_WINDOW_GET_VISIBILITY, () => {
    return getPetWindowVisibility()
  })

  ipcMain.handle(IPC_CHANNELS.MANAGEMENT_CONFIG_GET, () => {
    return loadManagementConfig()
  })

  ipcMain.handle(IPC_CHANNELS.MANAGEMENT_CONFIG_SAVE, (_event, settings: unknown) => {
    const onlineApiKey = getOnlineApiKeyInput(settings)
    if (onlineApiKey) {
      saveOnlineApiKey(onlineApiKey)
    }

    const savedSettings = saveManagementConfig(settings)
    applyPetWindowAlwaysOnTop(savedSettings.alwaysOnTop)
    refreshTrayMenu()
    return savedSettings
  })

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_LIST, (_event, limit: unknown) => {
    return listMessages(typeof limit === 'number' ? limit : undefined)
  })

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_CLEAR, () => {
    clearMessages()
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, (_event, limit: unknown) => {
    return listMemories(typeof limit === 'number' ? limit : undefined)
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, (_event, id: unknown) => {
    return deleteMemory(typeof id === 'string' ? id : '')
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_CLEAR, () => {
    clearMemories()
  })

  ipcMain.handle(IPC_CHANNELS.RAG_DOCUMENTS_LIST, () => {
    return listRagDocuments().map(toRagDocumentView)
  })

  ipcMain.handle(IPC_CHANNELS.RAG_DOCUMENTS_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      title: '导入知识库资料',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Text, Markdown, DOCX, and PDF',
          extensions: ['txt', 'md', 'docx', 'pdf']
        }
      ]
    })

    if (result.canceled) return []

    return Promise.all(result.filePaths.map((filePath) => importRagDocument(filePath)))
  })

  ipcMain.handle(IPC_CHANNELS.RAG_DOCUMENT_DELETE, (_event, id: unknown) => {
    return deleteRagDocument(typeof id === 'string' ? id : '')
  })

  ipcMain.handle(IPC_CHANNELS.RAG_DOCUMENTS_CLEAR, () => {
    clearRagDocuments()
  })

  ipcMain.handle(IPC_CHANNELS.RAG_ENABLED_SAVE, (_event, enabled: unknown) => {
    return saveRagEnabled(Boolean(enabled))
  })

  ipcMain.handle(IPC_CHANNELS.QA_TEST_ONLINE_CONNECTION, () => {
    return testOnlineQaConnection()
  })

  ipcMain.handle(IPC_CHANNELS.QA_OLLAMA_DETECT, () => {
    return detectOllama()
  })

  ipcMain.handle(IPC_CHANNELS.QA_OLLAMA_TEST_QUESTION, (_event, question: unknown) => {
    return testOllamaQuestion(typeof question === 'string' ? question : '')
  })

  ipcMain.handle(IPC_CHANNELS.QA_MOCK_RULES_GET, () => {
    return loadMockQaRules()
  })

  ipcMain.handle(IPC_CHANNELS.QA_MOCK_RULES_SAVE, (_event, rules: unknown) => {
    return saveMockQaRules(rules)
  })

  ipcMain.handle(IPC_CHANNELS.QA_MOCK_RULES_RESTORE_DEFAULTS, () => {
    return restoreDefaultMockQaRules()
  })

  ipcMain.handle(IPC_CHANNELS.QA_ASK, async (_event, question: string, source: unknown) => {
    const normalizedQuestion = typeof question === 'string' ? question : ''
    const conversationSource = parseConversationSource(source)

    try {
      return await askQuestion(normalizedQuestion, undefined, conversationSource)
    } catch {
      return {
        answer: '问答服务暂时不可用，请稍后再试。',
        type: 'mock'
      }
    }
  })
}

function getOnlineApiKeyInput(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object' || !('onlineApiKey' in settings)) return undefined

  const onlineApiKey = (settings as { onlineApiKey?: unknown }).onlineApiKey
  if (typeof onlineApiKey !== 'string') return undefined

  return onlineApiKey.trim() || undefined
}

function parseConversationSource(source: unknown): ChatMessageSource {
  return source === 'management' ? 'management' : 'pet'
}

function toRagDocumentView(document: RagDocument) {
  return {
    id: document.id,
    name: document.name,
    type: document.type,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    chunkCount: document.chunkCount,
    indexingStatus: document.indexingStatus,
    ...(document.indexingError ? { indexingError: document.indexingError } : {})
  }
}
