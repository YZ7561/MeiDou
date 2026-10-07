<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSpeechSynthesis } from '../composables/useSpeechSynthesis'
import MarkdownMessage from './components/MarkdownMessage.vue'

type PetState = 'idle' | 'happy' | 'sleep'
type PetWindowVisibility = 'running' | 'hidden'
type ManagementPage = 'overview' | 'settings' | 'voice' | 'memory' | 'knowledge'
const CONVERSATION_HISTORY_LIMIT = 300
const VOICE_PREVIEW_TEXT = '你好呀，我是 MeiDou。'
const PREFERRED_VOICE_LANGUAGES = ['zh-CN', 'zh-HK', 'zh-TW']

const activePage = ref<ManagementPage>('overview')
const petState = ref<PetState>('idle')
const petWindowVisibility = ref<PetWindowVisibility>('hidden')
const settings = ref<ManagementConfig>({
  autoShowPetOnLaunch: true,
  alwaysOnTop: true,
  defaultQaProvider: 'mock',
  model: '',
  onlineApiBaseUrl: 'https://api.openai.com/v1',
  onlineRequestTimeoutMs: 60000,
  hasOnlineApiKey: false,
  ollamaApiBaseUrl: 'http://localhost:11434/api',
  ollamaModel: '',
  longMemoryEnabled: true,
  ragEnabled: true,
  voice: {
    enabled: false,
    autoSpeakAnswer: true,
    engine: 'system',
    rate: 1,
    volume: 1,
    pitch: 1,
    voiceName: ''
  }
})
const apiKeyInput = ref('')
const ollamaModels = ref<string[]>([])
const ollamaDetectionResult = ref<OllamaDetectionResult | null>(null)
const ollamaTestQuestion = ref('你好，请简单介绍一下自己。')
const ollamaQuestionResult = ref<OllamaQuestionTestResult | null>(null)
const mockRules = ref<MockQaRule[]>([])
const conversationMessages = ref<ConversationMessage[]>([])
const conversationInput = ref('')
const conversationError = ref('')
const conversationScrollRef = ref<HTMLElement | null>(null)
const memories = ref<LongTermMemory[]>([])
const ragDocuments = ref<RagDocumentSummary[]>([])
const isPetWindowActionPending = ref(false)
const isSettingsLoaded = ref(false)
const isSettingsSaving = ref(false)
const isMockRulesLoaded = ref(false)
const isMockRulesSaving = ref(false)
const isConnectionTesting = ref(false)
const isConversationLoading = ref(true)
const isConversationSending = ref(false)
const isMemoryLoading = ref(false)
const isMemoryActionPending = ref(false)
const isMemorySettingsSaving = ref(false)
const isRagLoading = ref(false)
const isRagActionPending = ref(false)
const isRagSettingsSaving = ref(false)
const isOllamaDetecting = ref(false)
const isOllamaTesting = ref(false)
const settingsMessage = ref('')
const mockRulesMessage = ref('')
const memoryMessage = ref('')
const ragMessage = ref('')
const connectionTestResult = ref<QaConnectionTestResult | null>(null)
const systemVoices = ref<SpeechSynthesisVoice[]>([])
let removePetStateListener: (() => void) | undefined
let removePetWindowVisibilityListener: (() => void) | undefined
let removeVoicesChangedListener: (() => void) | undefined
let hasDetectedOllama = false
const { speak: speakVoicePreview, stop: stopVoicePreview } = useSpeechSynthesis()
const sortedSystemVoices = computed(() => [...systemVoices.value].sort(compareSystemVoices))
const hasSelectedSystemVoice = computed(() => {
  const selectedVoiceName = settings.value.voice.voiceName
  return sortedSystemVoices.value.some((voice) => voice.name === selectedVoiceName)
})
const canSendConversationMessage = computed(
  () =>
    conversationInput.value.trim().length > 0 &&
    !isConversationSending.value &&
    !isConversationLoading.value
)
const sortedMemories = computed(() =>
  [...memories.value].sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
)
const sortedRagDocuments = computed(() =>
  [...ragDocuments.value].sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
)

watch(
  () => settings.value.defaultQaProvider,
  (provider) => {
    connectionTestResult.value = null
    ollamaQuestionResult.value = null

    if (provider === 'local' && isSettingsLoaded.value && !hasDetectedOllama) {
      void detectOllamaModels()
    }
  }
)

watch(activePage, (page) => {
  if (page === 'overview') {
    void scrollConversationToBottom()
  }

  if (page === 'memory') {
    void loadMemories()
  }

  if (page === 'knowledge') {
    void loadRagDocuments()
  }
})

onMounted(async () => {
  setupSystemVoiceList()

  const [savedPetState, savedPetWindowVisibility, savedSettings, savedMockRules] = await Promise.all([
    window.meidouAPI.getPetState(),
    window.meidouAPI.getPetWindowVisibility(),
    window.meidouAPI.getManagementConfig(),
    window.meidouAPI.getMockQaRules()
  ])

  petState.value = savedPetState
  petWindowVisibility.value = savedPetWindowVisibility
  settings.value = savedSettings
  mockRules.value = savedMockRules
  isSettingsLoaded.value = true
  isMockRulesLoaded.value = true
  if (savedSettings.defaultQaProvider === 'local') {
    void detectOllamaModels()
  }
  removePetStateListener = window.meidouAPI.onPetStateChanged((state) => {
    petState.value = state
  })
  removePetWindowVisibilityListener = window.meidouAPI.onPetWindowVisibilityChanged((visibility) => {
    petWindowVisibility.value = visibility
  })

  await loadConversationMessages()
})

onBeforeUnmount(() => {
  removePetStateListener?.()
  removePetWindowVisibilityListener?.()
  removeVoicesChangedListener?.()
  stopVoicePreview()
})

async function showPetWindow(): Promise<void> {
  if (isPetWindowActionPending.value) return

  isPetWindowActionPending.value = true

  try {
    petWindowVisibility.value = await window.meidouAPI.showPetWindow()
  } finally {
    isPetWindowActionPending.value = false
  }
}

async function hidePetWindow(): Promise<void> {
  if (isPetWindowActionPending.value) return

  isPetWindowActionPending.value = true

  try {
    petWindowVisibility.value = await window.meidouAPI.hidePetWindow()
  } finally {
    isPetWindowActionPending.value = false
  }
}

async function loadConversationMessages(shouldScroll = true): Promise<void> {
  isConversationLoading.value = true
  conversationError.value = ''

  try {
    conversationMessages.value =
      await window.meidouAPI.listConversationMessages(CONVERSATION_HISTORY_LIMIT)

    if (shouldScroll) {
      await scrollConversationToBottom()
    }
  } catch {
    conversationError.value = '聊天记录读取失败，请稍后重试。'
  } finally {
    isConversationLoading.value = false
  }
}

async function sendConversationMessage(): Promise<void> {
  const question = conversationInput.value.trim()
  if (!question || isConversationSending.value) return

  isConversationSending.value = true
  conversationError.value = ''

  try {
    conversationInput.value = ''
    await window.meidouAPI.askQuestion(question, 'management')
    await loadConversationMessages()
  } catch {
    await loadConversationMessages()
    conversationError.value = '发送失败，请稍后再试。'
  } finally {
    isConversationSending.value = false
    await scrollConversationToBottom()
  }
}

async function scrollConversationToBottom(): Promise<void> {
  await nextTick()

  const scrollElement = conversationScrollRef.value
  if (!scrollElement) return

  scrollElement.scrollTop = scrollElement.scrollHeight
}

function isUserConversationMessage(message: ConversationMessage): boolean {
  return message.role === 'user'
}

function formatConversationTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function loadMemories(): Promise<void> {
  isMemoryLoading.value = true
  memoryMessage.value = ''

  try {
    memories.value = await window.meidouAPI.listMemories()
  } catch (error) {
    memoryMessage.value = `记忆读取失败：${getErrorMessage(error)}`
  } finally {
    isMemoryLoading.value = false
  }
}

async function saveLongMemoryEnabled(): Promise<void> {
  if (!isSettingsLoaded.value || isMemorySettingsSaving.value) return

  const enabled = Boolean(settings.value.longMemoryEnabled)
  isMemorySettingsSaving.value = true
  memoryMessage.value = ''

  try {
    settings.value = await window.meidouAPI.saveManagementConfig(createManagementConfigUpdate())
    memoryMessage.value = settings.value.longMemoryEnabled ? '长记忆已启用。' : '长记忆已关闭。'
  } catch (error) {
    settings.value.longMemoryEnabled = !enabled
    memoryMessage.value = `长记忆设置保存失败：${getErrorMessage(error)}`
  } finally {
    isMemorySettingsSaving.value = false
  }
}

async function deleteLongTermMemory(memory: LongTermMemory): Promise<void> {
  if (isMemoryActionPending.value) return
  if (!window.confirm(`确认删除这条记忆？\n\n${memory.content}`)) return

  isMemoryActionPending.value = true
  memoryMessage.value = ''

  try {
    await window.meidouAPI.deleteMemory(memory.id)
    await loadMemories()
    memoryMessage.value = '记忆已删除。'
  } catch (error) {
    memoryMessage.value = `记忆删除失败：${getErrorMessage(error)}`
  } finally {
    isMemoryActionPending.value = false
  }
}

async function clearAllMemories(): Promise<void> {
  if (isMemoryActionPending.value) return

  if (memories.value.length === 0) {
    memoryMessage.value = '当前没有可清空的记忆。'
    return
  }

  if (!window.confirm('确认清空全部长期记忆？此操作不可撤销。')) return

  isMemoryActionPending.value = true
  memoryMessage.value = ''

  try {
    await window.meidouAPI.clearMemories()
    await loadMemories()
    memoryMessage.value = '全部记忆已清空。'
  } catch (error) {
    memoryMessage.value = `清空记忆失败：${getErrorMessage(error)}`
  } finally {
    isMemoryActionPending.value = false
  }
}

async function loadRagDocuments(): Promise<void> {
  isRagLoading.value = true
  ragMessage.value = ''

  try {
    ragDocuments.value = await window.meidouAPI.listRagDocuments()
  } catch (error) {
    ragMessage.value = `知识库读取失败：${getErrorMessage(error)}`
  } finally {
    isRagLoading.value = false
  }
}

async function importRagDocuments(): Promise<void> {
  if (isRagActionPending.value) return

  isRagActionPending.value = true
  ragMessage.value = ''

  try {
    const results = await window.meidouAPI.importRagDocuments()
    await loadRagDocuments()

    if (results.length === 0) {
      ragMessage.value = '未选择文件。'
      return
    }

    const readyCount = results.filter((result) => result.indexingStatus === 'ready').length
    const partialCount = results.filter((result) => result.indexingStatus === 'partial').length
    const failedCount = results.filter((result) => result.indexingStatus === 'failed').length
    ragMessage.value = `已导入 ${results.length} 个文件，索引完成 ${readyCount} 个，部分完成 ${partialCount} 个，失败 ${failedCount} 个。`
  } catch (error) {
    await loadRagDocuments()
    ragMessage.value = `导入失败：${getErrorMessage(error)}`
  } finally {
    isRagActionPending.value = false
  }
}

async function saveRagEnabled(): Promise<void> {
  if (!isSettingsLoaded.value || isRagSettingsSaving.value) return

  const enabled = Boolean(settings.value.ragEnabled)
  isRagSettingsSaving.value = true
  ragMessage.value = ''

  try {
    settings.value = await window.meidouAPI.saveRagEnabled(enabled)
    ragMessage.value = settings.value.ragEnabled ? 'RAG 已启用。' : 'RAG 已关闭。'
  } catch (error) {
    settings.value.ragEnabled = !enabled
    ragMessage.value = `RAG 设置保存失败：${getErrorMessage(error)}`
  } finally {
    isRagSettingsSaving.value = false
  }
}

async function deleteRagDocument(document: RagDocumentSummary): Promise<void> {
  if (isRagActionPending.value) return
  if (!window.confirm(`确认删除这份资料？\n\n${document.name}`)) return

  isRagActionPending.value = true
  ragMessage.value = ''

  try {
    await window.meidouAPI.deleteRagDocument(document.id)
    await loadRagDocuments()
    ragMessage.value = '资料已删除。'
  } catch (error) {
    ragMessage.value = `资料删除失败：${getErrorMessage(error)}`
  } finally {
    isRagActionPending.value = false
  }
}

async function clearAllRagDocuments(): Promise<void> {
  if (isRagActionPending.value) return

  if (ragDocuments.value.length === 0) {
    ragMessage.value = '当前没有可清空的资料。'
    return
  }

  if (!window.confirm('确认清空全部知识库资料？此操作不可撤销。')) return

  isRagActionPending.value = true
  ragMessage.value = ''

  try {
    await window.meidouAPI.clearRagDocuments()
    await loadRagDocuments()
    ragMessage.value = '知识库已清空。'
  } catch (error) {
    ragMessage.value = `清空知识库失败：${getErrorMessage(error)}`
  } finally {
    isRagActionPending.value = false
  }
}

function formatMemoryType(type: LongTermMemoryType): string {
  switch (type) {
    case 'fact':
      return '事实'
    case 'preference':
      return '偏好'
    case 'project':
      return '项目'
    case 'emotion':
      return '情绪'
    case 'todo':
      return '待办'
    default:
      return type
  }
}

function formatMemoryConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

function formatMemoryTime(updatedAt: string): string {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRagIndexingStatus(status: RagDocumentIndexingStatus): string {
  switch (status) {
    case 'ready':
      return '索引完成'
    case 'partial':
      return '部分完成'
    case 'failed':
      return '索引失败'
    case 'pending':
      return '等待索引'
    default:
      return status
  }
}

function getRagStatusClass(status: RagDocumentIndexingStatus): string {
  if (status === 'ready') return 'knowledge-status--ready'
  if (status === 'partial') return 'knowledge-status--partial'
  if (status === 'failed') return 'knowledge-status--failed'

  return 'knowledge-status--pending'
}

function formatRagTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function saveSettings(): Promise<void> {
  await persistSettings(true)
}

async function saveVoiceSettings(showSuccessMessage = true): Promise<void> {
  if (!isSettingsLoaded.value || isSettingsSaving.value) return

  isSettingsSaving.value = true
  settingsMessage.value = ''

  try {
    settings.value = await window.meidouAPI.saveManagementConfig(createManagementConfigUpdate())
    settingsMessage.value = showSuccessMessage ? '配音设置已保存。' : ''
  } catch (error) {
    settingsMessage.value = `配音设置保存失败：${getErrorMessage(error)}`
  } finally {
    isSettingsSaving.value = false
  }
}

async function previewVoice(): Promise<void> {
  await saveVoiceSettings(false)
  stopVoicePreview()
  speakVoicePreview(VOICE_PREVIEW_TEXT, createVoiceConfigPayload())
}

function addMockRule(): void {
  mockRules.value.push({ keyword: '', answer: '' })
  mockRulesMessage.value = ''
}

function removeMockRule(index: number): void {
  mockRules.value.splice(index, 1)
  mockRulesMessage.value = ''
}

async function saveMockRules(): Promise<void> {
  if (!isMockRulesLoaded.value || isMockRulesSaving.value) return

  const validationError = validateMockRules()
  if (validationError) {
    mockRulesMessage.value = validationError
    return
  }

  isMockRulesSaving.value = true
  mockRulesMessage.value = ''

  try {
    mockRules.value = await window.meidouAPI.saveMockQaRules(createMockRulesPayload())
    mockRulesMessage.value = 'Mock 规则已保存。'
  } catch (error) {
    mockRulesMessage.value = `Mock 规则保存失败：${getErrorMessage(error)}`
  } finally {
    isMockRulesSaving.value = false
  }
}

async function restoreDefaultMockRules(): Promise<void> {
  if (!isMockRulesLoaded.value || isMockRulesSaving.value) return

  isMockRulesSaving.value = true
  mockRulesMessage.value = ''

  try {
    mockRules.value = await window.meidouAPI.restoreDefaultMockQaRules()
    mockRulesMessage.value = '已恢复并保存默认 Mock 规则。'
  } catch (error) {
    mockRulesMessage.value = `恢复默认规则失败：${getErrorMessage(error)}`
  } finally {
    isMockRulesSaving.value = false
  }
}

async function testOnlineConnection(): Promise<void> {
  if (isConnectionTesting.value || isSettingsSaving.value) return

  connectionTestResult.value = null
  const settingsSaved = await persistSettings(false)
  if (!settingsSaved) return

  isConnectionTesting.value = true

  try {
    connectionTestResult.value = await window.meidouAPI.testOnlineConnection()
  } catch (error) {
    connectionTestResult.value = {
      success: false,
      message: `连接失败：${getErrorMessage(error)}`
    }
  } finally {
    isConnectionTesting.value = false
  }
}

async function detectOllamaModels(): Promise<void> {
  if (isOllamaDetecting.value) return

  isOllamaDetecting.value = true
  hasDetectedOllama = true
  ollamaQuestionResult.value = null

  try {
    const result = await window.meidouAPI.detectOllama()
    ollamaDetectionResult.value = result
    ollamaModels.value = result.models

    if (result.available && result.models.length > 0) {
      if (!result.models.includes(settings.value.ollamaModel)) {
        settings.value.ollamaModel = result.models[0]
      }
    } else {
      settings.value.ollamaModel = ''
    }
  } catch {
    ollamaModels.value = []
    settings.value.ollamaModel = ''
    ollamaDetectionResult.value = {
      available: false,
      models: [],
      message: 'Ollama 检测失败，请稍后重试。'
    }
  } finally {
    isOllamaDetecting.value = false
  }
}

async function testLocalQuestion(): Promise<void> {
  if (isOllamaTesting.value || isSettingsSaving.value) return

  ollamaQuestionResult.value = null
  const question = ollamaTestQuestion.value.trim()
  if (!question) {
    ollamaQuestionResult.value = {
      success: false,
      message: '测试问题不能为空。'
    }
    return
  }

  const settingsSaved = await persistSettings(false)
  if (!settingsSaved) return

  isOllamaTesting.value = true

  try {
    ollamaQuestionResult.value = await window.meidouAPI.testOllamaQuestion(question)
  } catch {
    ollamaQuestionResult.value = {
      success: false,
      message: 'Ollama 问答测试失败，请确认服务仍在运行。'
    }
  } finally {
    isOllamaTesting.value = false
  }
}

async function persistSettings(showSuccessMessage: boolean): Promise<boolean> {
  if (!isSettingsLoaded.value || isSettingsSaving.value) return false

  const validationError = validateSettings()
  if (validationError) {
    settingsMessage.value = validationError
    return false
  }

  isSettingsSaving.value = true
  settingsMessage.value = ''

  try {
    const update = createManagementConfigUpdate()
    const onlineApiKey = apiKeyInput.value.trim()
    if (onlineApiKey) {
      update.onlineApiKey = onlineApiKey
    }

    settings.value = await window.meidouAPI.saveManagementConfig(update)
    apiKeyInput.value = ''
    settingsMessage.value = showSuccessMessage ? '设置已保存。' : ''
    return true
  } catch (error) {
    settingsMessage.value = `设置保存失败：${getErrorMessage(error)}`
    return false
  } finally {
    isSettingsSaving.value = false
  }
}

function validateSettings(): string | undefined {
  if (settings.value.defaultQaProvider === 'local') {
    return settings.value.ollamaModel ? undefined : '请先检测并选择一个 Ollama 模型。'
  }

  if (settings.value.defaultQaProvider !== 'online') return undefined

  if (!settings.value.model.trim()) {
    return '模型名称不能为空。'
  }

  try {
    const url = new URL(settings.value.onlineApiBaseUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'API Base URL 仅支持 HTTP 或 HTTPS。'
    }
  } catch {
    return 'API Base URL 格式无效。'
  }

  const timeout = settings.value.onlineRequestTimeoutMs
  if (!Number.isFinite(timeout) || timeout < 5000 || timeout > 300000) {
    return '请求超时必须在 5000 至 300000 毫秒之间。'
  }

  return undefined
}

function validateMockRules(): string | undefined {
  const keywords = new Set<string>()

  for (let index = 0; index < mockRules.value.length; index += 1) {
    const rule = mockRules.value[index]
    const keyword = rule.keyword.trim()
    const answer = rule.answer.trim()

    if (!keyword) return `第 ${index + 1} 条规则的关键词不能为空。`
    if (!answer) return `第 ${index + 1} 条规则的固定回答不能为空。`

    const comparableKeyword = keyword.toLocaleLowerCase()
    if (keywords.has(comparableKeyword)) return `关键词“${keyword}”重复。`
    keywords.add(comparableKeyword)
  }

  return undefined
}

function createMockRulesPayload(): MockQaRule[] {
  return mockRules.value.map((rule) => ({
    keyword: rule.keyword.trim(),
    answer: rule.answer.trim()
  }))
}

function createManagementConfigUpdate(): ManagementConfigUpdate {
  return {
    autoShowPetOnLaunch: settings.value.autoShowPetOnLaunch,
    alwaysOnTop: settings.value.alwaysOnTop,
    defaultQaProvider: settings.value.defaultQaProvider,
    model: settings.value.model.trim(),
    onlineApiBaseUrl: settings.value.onlineApiBaseUrl.trim(),
    onlineRequestTimeoutMs: settings.value.onlineRequestTimeoutMs,
    ollamaModel: settings.value.ollamaModel,
    longMemoryEnabled: Boolean(settings.value.longMemoryEnabled),
    voice: createVoiceConfigPayload()
  }
}

function createVoiceConfigPayload(): VoiceConfig {
  return {
    enabled: Boolean(settings.value.voice.enabled),
    autoSpeakAnswer: Boolean(settings.value.voice.autoSpeakAnswer),
    engine: 'system',
    rate: toFiniteNumber(settings.value.voice.rate, 1),
    volume: toFiniteNumber(settings.value.voice.volume, 1),
    pitch: toFiniteNumber(settings.value.voice.pitch, 1),
    voiceName: normalizeVoiceName(settings.value.voice.voiceName)
  }
}

function setupSystemVoiceList(): void {
  loadSystemVoices()

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  window.speechSynthesis.addEventListener('voiceschanged', loadSystemVoices)
  removeVoicesChangedListener = () => {
    window.speechSynthesis.removeEventListener('voiceschanged', loadSystemVoices)
  }
}

function loadSystemVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    systemVoices.value = []
    return
  }

  systemVoices.value = window.speechSynthesis.getVoices()
}

function compareSystemVoices(first: SpeechSynthesisVoice, second: SpeechSynthesisVoice): number {
  const priorityDifference = getSystemVoicePriority(first) - getSystemVoicePriority(second)
  if (priorityDifference !== 0) return priorityDifference

  return first.name.localeCompare(second.name, 'zh-CN')
}

function getSystemVoicePriority(voice: SpeechSynthesisVoice): number {
  const normalizedLanguage = voice.lang.toLocaleLowerCase()
  const preferredIndex = PREFERRED_VOICE_LANGUAGES.findIndex(
    (language) => normalizedLanguage === language.toLocaleLowerCase()
  )

  if (preferredIndex >= 0) return preferredIndex
  if (normalizedLanguage.startsWith('zh')) return PREFERRED_VOICE_LANGUAGES.length

  return PREFERRED_VOICE_LANGUAGES.length + 1
}

function normalizeVoiceName(voiceName: unknown): string {
  return typeof voiceName === 'string' ? voiceName.trim() : ''
}

function toFiniteNumber(value: unknown, defaultValue: number): number {
  if (value === '') return defaultValue

  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : defaultValue
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <div class="management-shell">
    <header class="management-header">
      <div>
        <p class="eyebrow">MEIDOU</p>
        <h1>管理中心</h1>
      </div>
      <div class="status-group">
        <div class="status-chip" :class="`status-chip--${petWindowVisibility}`">
          <span class="status-dot" aria-hidden="true"></span>
          桌宠：{{ petWindowVisibility === 'running' ? '运行中' : '已隐藏' }}
        </div>
        <div class="pet-state">当前状态：{{ petState }}</div>
      </div>
    </header>

    <div class="management-body">
      <nav class="management-nav" aria-label="管理中心导航">
        <button
          class="nav-item"
          :class="{ 'nav-item--active': activePage === 'overview' }"
          type="button"
          @click="activePage = 'overview'"
        >
          聊天
        </button>
        <button
          class="nav-item"
          :class="{ 'nav-item--active': activePage === 'settings' }"
          type="button"
          @click="activePage = 'settings'"
        >
          本地设置
        </button>
        <button
          class="nav-item"
          :class="{ 'nav-item--active': activePage === 'voice' }"
          type="button"
          @click="activePage = 'voice'"
        >
          桌宠配音
        </button>
        <button
          class="nav-item"
          :class="{ 'nav-item--active': activePage === 'knowledge' }"
          type="button"
          @click="activePage = 'knowledge'"
        >
          知识库
        </button>
        <button
          class="nav-item"
          :class="{ 'nav-item--active': activePage === 'memory' }"
          type="button"
          @click="activePage = 'memory'"
        >
          记忆
        </button>
        <span class="nav-item nav-item--disabled">更多功能（占位）</span>
      </nav>

      <main
        class="management-content"
        :class="{ 'management-content--chat': activePage === 'overview' }"
      >
        <template v-if="activePage === 'overview'">
          <section class="chat-page" aria-labelledby="chat-title">
            <header class="chat-page-header">
              <div>
                <p class="content-kicker">MEIDOU CHAT</p>
                <h2 id="chat-title">和 MeiDou 聊天</h2>
                <p class="content-description">这里会显示桌宠和管理中心产生的聊天历史。</p>
              </div>

              <div class="chat-pet-status" aria-label="桌宠窗口状态">
                <div
                  class="status-chip"
                  :class="
                    petWindowVisibility === 'running'
                      ? 'status-chip--running'
                      : 'status-chip--hidden'
                  "
                >
                  <span class="status-dot" aria-hidden="true"></span>
                  桌宠：{{ petWindowVisibility === 'running' ? '运行中' : '已隐藏' }}
                </div>
                <div class="chat-pet-actions">
                  <button
                    class="control-button control-button--primary"
                    type="button"
                    :disabled="isPetWindowActionPending"
                    @click="showPetWindow"
                  >
                    显示桌宠
                  </button>
                  <button
                    class="control-button"
                    type="button"
                    :disabled="isPetWindowActionPending"
                    @click="hidePetWindow"
                  >
                    隐藏
                  </button>
                </div>
              </div>
            </header>

            <div class="conversation-panel">
              <div ref="conversationScrollRef" class="conversation-list" aria-live="polite">
                <p v-if="isConversationLoading" class="conversation-empty">正在读取聊天记录...</p>
                <p v-else-if="conversationMessages.length === 0" class="conversation-empty">
                  还没有聊天记录，先和 MeiDou 说句话吧。
                </p>

                <div
                  v-for="message in conversationMessages"
                  :key="message.id"
                  class="conversation-message"
                  :class="
                    isUserConversationMessage(message)
                      ? 'conversation-message--user'
                      : 'conversation-message--assistant'
                  "
                >
                  <div class="conversation-avatar" aria-hidden="true">
                    {{ isUserConversationMessage(message) ? '我' : 'M' }}
                  </div>
                  <div class="conversation-bubble-wrap">
                    <div class="conversation-meta">
                      {{ isUserConversationMessage(message) ? '你' : 'MeiDou' }}
                      <span v-if="formatConversationTime(message.createdAt)">
                        · {{ formatConversationTime(message.createdAt) }}
                      </span>
                    </div>
                    <div
                      class="conversation-bubble"
                      :class="{
                        'conversation-bubble--markdown': !isUserConversationMessage(message)
                      }"
                    >
                      <MarkdownMessage
                        v-if="!isUserConversationMessage(message)"
                        :content="message.content"
                      />
                      <template v-else>{{ message.content }}</template>
                    </div>
                  </div>
                </div>

                <div
                  v-if="isConversationSending"
                  class="conversation-message conversation-message--assistant"
                >
                  <div class="conversation-avatar" aria-hidden="true">M</div>
                  <div class="conversation-bubble-wrap">
                    <div class="conversation-meta">MeiDou</div>
                    <div class="conversation-bubble conversation-bubble--pending">正在输入...</div>
                  </div>
                </div>
              </div>

              <form class="conversation-input-bar" @submit.prevent="sendConversationMessage">
                <textarea
                  v-model="conversationInput"
                  class="conversation-input"
                  rows="1"
                  maxlength="1000"
                  placeholder="输入消息，按 Enter 发送"
                  :disabled="isConversationSending"
                  @keydown.enter.exact.prevent="sendConversationMessage"
                ></textarea>
                <button
                  class="conversation-send-button"
                  type="submit"
                  :disabled="!canSendConversationMessage"
                >
                  {{ isConversationSending ? '发送中' : '发送' }}
                </button>
              </form>

              <p v-if="conversationError" class="conversation-error" role="alert">
                {{ conversationError }}
              </p>
            </div>
          </section>
        </template>

        <section v-else-if="activePage === 'knowledge'" class="memory-section" aria-labelledby="knowledge-title">
          <header class="memory-page-header">
            <div>
              <p class="content-kicker">MEIDOU KNOWLEDGE</p>
              <h2 id="knowledge-title">知识库</h2>
              <p class="content-description">
                导入 .txt / .md / .docx / .pdf 学习资料，MeiDou 会在本地读取、切块、向量化，并在问答时检索相关片段。单文件最大 50 MB，建议按章节拆分长文档。
              </p>
            </div>
            <div class="memory-actions">
              <button
                class="control-button control-button--primary"
                type="button"
                :disabled="isRagLoading || isRagActionPending"
                @click="importRagDocuments"
              >
                {{ isRagActionPending ? '处理中...' : '导入资料' }}
              </button>
              <button
                class="control-button"
                type="button"
                :disabled="isRagLoading || isRagActionPending"
                @click="loadRagDocuments"
              >
                {{ isRagLoading ? '刷新中...' : '刷新' }}
              </button>
              <button
                class="control-button control-button--danger"
                type="button"
                :disabled="isRagLoading || isRagActionPending || ragDocuments.length === 0"
                @click="clearAllRagDocuments"
              >
                清空全部
              </button>
            </div>
          </header>

          <div class="memory-toggle-card">
            <label class="checkbox-field">
              <input
                v-model="settings.ragEnabled"
                type="checkbox"
                :disabled="!isSettingsLoaded || isRagSettingsSaving"
                @change="saveRagEnabled"
              />
              <span>
                <strong>启用 RAG</strong>
                <small>开启后，在线或本地问答会先检索知识库片段，再将相关资料加入 prompt。</small>
              </span>
            </label>
          </div>

          <p v-if="ragMessage" class="settings-message memory-message" role="status">
            {{ ragMessage }}
          </p>

          <div class="memory-list" aria-live="polite">
            <p v-if="isRagLoading" class="memory-empty">正在读取知识库...</p>
            <p v-else-if="sortedRagDocuments.length === 0" class="memory-empty">
              当前还没有导入资料。支持 .txt、.md、.docx 和 .pdf 文件。
            </p>

            <article
              v-for="document in sortedRagDocuments"
              :key="document.id"
              class="memory-card knowledge-card"
            >
              <header class="memory-card-header">
                <div class="memory-meta">
                  <span class="memory-type">{{ document.type.toUpperCase() }}</span>
                  <span :class="['knowledge-status', getRagStatusClass(document.indexingStatus)]">
                    {{ formatRagIndexingStatus(document.indexingStatus) }}
                  </span>
                  <span>{{ document.chunkCount }} chunks</span>
                  <span v-if="formatRagTime(document.createdAt)">导入 {{ formatRagTime(document.createdAt) }}</span>
                </div>
                <button
                  class="control-button control-button--danger"
                  type="button"
                  :disabled="isRagActionPending"
                  @click="deleteRagDocument(document)"
                >
                  删除
                </button>
              </header>
              <p class="memory-content">{{ document.name }}</p>
              <p v-if="document.indexingError" class="knowledge-error">{{ document.indexingError }}</p>
            </article>
          </div>
        </section>

        <section v-else-if="activePage === 'memory'" class="memory-section" aria-labelledby="memory-title">
          <header class="memory-page-header">
            <div>
              <p class="content-kicker">MEIDOU MEMORY</p>
              <h2 id="memory-title">记忆管理</h2>
              <p class="content-description">
                查看和管理 MeiDou 已保存的长期记忆。关闭后不会向问答注入长期记忆，也不会继续提炼新记忆。
              </p>
            </div>
            <div class="memory-actions">
              <button
                class="control-button"
                type="button"
                :disabled="isMemoryLoading || isMemoryActionPending"
                @click="loadMemories"
              >
                {{ isMemoryLoading ? '刷新中...' : '刷新' }}
              </button>
              <button
                class="control-button control-button--danger"
                type="button"
                :disabled="isMemoryLoading || isMemoryActionPending || memories.length === 0"
                @click="clearAllMemories"
              >
                清空全部
              </button>
            </div>
          </header>

          <div class="memory-toggle-card">
            <label class="checkbox-field">
              <input
                v-model="settings.longMemoryEnabled"
                type="checkbox"
                :disabled="!isSettingsLoaded || isMemorySettingsSaving"
                @change="saveLongMemoryEnabled"
              />
              <span>
                <strong>启用长记忆</strong>
                <small>开启后，MeiDou 会在回复时参考重要长期记忆，并在成功回复后异步提炼新记忆。</small>
              </span>
            </label>
          </div>

          <p v-if="memoryMessage" class="settings-message memory-message" role="status">
            {{ memoryMessage }}
          </p>

          <div class="memory-list" aria-live="polite">
            <p v-if="isMemoryLoading" class="memory-empty">正在读取记忆...</p>
            <p v-else-if="sortedMemories.length === 0" class="memory-empty">当前还没有长期记忆。</p>

            <article v-for="memory in sortedMemories" :key="memory.id" class="memory-card">
              <header class="memory-card-header">
                <div class="memory-meta">
                  <span class="memory-type">{{ formatMemoryType(memory.type) }}</span>
                  <span>重要度 {{ memory.importance }}</span>
                  <span>可信度 {{ formatMemoryConfidence(memory.confidence) }}</span>
                  <span v-if="formatMemoryTime(memory.updatedAt)">更新 {{ formatMemoryTime(memory.updatedAt) }}</span>
                </div>
                <button
                  class="control-button control-button--danger"
                  type="button"
                  :disabled="isMemoryActionPending"
                  @click="deleteLongTermMemory(memory)"
                >
                  删除
                </button>
              </header>
              <p class="memory-content">{{ memory.content }}</p>
            </article>
          </div>
        </section>

        <section v-else class="settings-section" aria-labelledby="settings-title">
          <div class="settings-heading">
            <p id="settings-title" class="section-title">
              {{ activePage === 'voice' ? '桌宠配音' : '本地设置' }}
            </p>
            <p class="section-description">
              {{
                activePage === 'voice'
                  ? '使用系统语音朗读 AI 回复，设置会保存到本地配置。'
                  : '常规配置保存在本机，API Key 使用系统安全存储加密。'
              }}
            </p>
          </div>

          <form
            class="settings-form"
            @submit.prevent="activePage === 'voice' ? saveVoiceSettings() : saveSettings()"
          >
            <template v-if="activePage === 'settings'">
            <label class="checkbox-field">
              <input v-model="settings.autoShowPetOnLaunch" type="checkbox" :disabled="!isSettingsLoaded" />
              <span>
                <strong>启动时自动显示桌宠</strong>
                <small>关闭后，应用启动时仅显示管理中心。</small>
              </span>
            </label>

            <label class="checkbox-field">
              <input v-model="settings.alwaysOnTop" type="checkbox" :disabled="!isSettingsLoaded" />
              <span>
                <strong>桌宠始终置顶</strong>
                <small>保存后立即应用到当前桌宠窗口。</small>
              </span>
            </label>

            </template>

            <template v-else>
            <label class="checkbox-field">
              <input
                v-model="settings.voice.enabled"
                type="checkbox"
                :disabled="!isSettingsLoaded || isSettingsSaving"
                @change="saveVoiceSettings(false)"
              />
              <span>
                <strong>启用 AI 配音</strong>
                <small>开启后，桌宠收到 AI 回复时使用系统配音自动朗读。</small>
              </span>
            </label>

            <div id="voice-settings" class="voice-settings" aria-labelledby="voice-settings-title">
              <div class="voice-settings-heading">
                <span id="voice-settings-title" class="field-label">桌宠配音</span>
                <p>使用系统语音朗读 AI 回复，可在这里试听并调整声音参数。</p>
              </div>

              <label class="input-field">
                <span>声音</span>
                <select
                  v-model="settings.voice.voiceName"
                  :disabled="!isSettingsLoaded || isSettingsSaving || sortedSystemVoices.length === 0"
                  @change="saveVoiceSettings(false)"
                >
                  <option value="">系统默认</option>
                  <option
                    v-if="settings.voice.voiceName && !hasSelectedSystemVoice"
                    :value="settings.voice.voiceName"
                  >
                    已保存声音不可用：{{ settings.voice.voiceName }}
                  </option>
                  <option
                    v-for="voice in sortedSystemVoices"
                    :key="voice.name + '-' + voice.lang"
                    :value="voice.name"
                  >
                    {{ voice.name }}{{ voice.lang ? ` (${voice.lang})` : '' }}
                  </option>
                </select>
                <small>
                  {{ sortedSystemVoices.length === 0 ? '正在读取系统声音...' : '优先显示中文系统声音。' }}
                </small>
              </label>

              <label class="input-field">
                <span>语速</span>
                <input
                  v-model.number="settings.voice.rate"
                  type="number"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  :disabled="!isSettingsLoaded || isSettingsSaving"
                  @change="saveVoiceSettings(false)"
                />
              </label>

              <label class="input-field">
                <span>音量</span>
                <input
                  v-model.number="settings.voice.volume"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  :disabled="!isSettingsLoaded || isSettingsSaving"
                  @change="saveVoiceSettings(false)"
                />
              </label>

              <label class="input-field">
                <span>音调</span>
                <input
                  v-model.number="settings.voice.pitch"
                  type="number"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  :disabled="!isSettingsLoaded || isSettingsSaving"
                  @change="saveVoiceSettings(false)"
                />
              </label>

              <div class="settings-actions">
                <button
                  class="control-button"
                  type="button"
                  :disabled="!isSettingsLoaded || isSettingsSaving"
                  @click="previewVoice"
                >
                  试听
                </button>
              </div>
            </div>

            </template>

            <template v-if="activePage === 'settings'">
            <fieldset class="provider-settings">
              <legend>默认 QA Provider</legend>
              <div class="provider-selector">
                <label>
                  <input v-model="settings.defaultQaProvider" type="radio" value="mock" :disabled="!isSettingsLoaded" />
                  <span>Mock</span>
                </label>
                <label>
                  <input v-model="settings.defaultQaProvider" type="radio" value="online" :disabled="!isSettingsLoaded" />
                  <span>Online API</span>
                </label>
                <label>
                  <input v-model="settings.defaultQaProvider" type="radio" value="local" :disabled="!isSettingsLoaded" />
                  <span>Local</span>
                </label>
              </div>
            </fieldset>

            <div v-if="settings.defaultQaProvider === 'mock'" class="mock-settings">
              <div class="mock-rules-header">
                <div>
                  <span class="field-label">关键词规则</span>
                  <p>问题包含关键词时返回对应的固定回答，按列表顺序优先命中。</p>
                </div>
                <button
                  class="control-button"
                  type="button"
                  :disabled="!isMockRulesLoaded || isMockRulesSaving"
                  @click="addMockRule"
                >
                  新增规则
                </button>
              </div>

              <p v-if="mockRules.length === 0" class="mock-rules-empty">当前没有 Mock 规则。</p>

              <div v-for="(rule, index) in mockRules" :key="index" class="mock-rule">
                <span class="mock-rule-index">{{ index + 1 }}</span>
                <div class="mock-rule-fields">
                  <label class="input-field">
                    <span>关键词</span>
                    <input
                      v-model="rule.keyword"
                      type="text"
                      maxlength="100"
                      autocomplete="off"
                      :disabled="isMockRulesSaving"
                    />
                  </label>
                  <label class="input-field">
                    <span>固定回答</span>
                    <textarea
                      v-model="rule.answer"
                      rows="2"
                      maxlength="2000"
                      :disabled="isMockRulesSaving"
                    ></textarea>
                  </label>
                </div>
                <button
                  class="control-button control-button--danger"
                  type="button"
                  :disabled="isMockRulesSaving"
                  :aria-label="`删除第 ${index + 1} 条规则`"
                  @click="removeMockRule(index)"
                >
                  删除
                </button>
              </div>

              <div class="mock-rules-footer">
                <span class="settings-message" role="status">{{ mockRulesMessage }}</span>
                <div class="settings-actions">
                  <button
                    class="control-button"
                    type="button"
                    :disabled="!isMockRulesLoaded || isMockRulesSaving"
                    @click="restoreDefaultMockRules"
                  >
                    恢复默认
                  </button>
                  <button
                    class="control-button control-button--primary"
                    type="button"
                    :disabled="!isMockRulesLoaded || isMockRulesSaving"
                    @click="saveMockRules"
                  >
                    {{ isMockRulesSaving ? '保存中...' : '保存规则' }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="settings.defaultQaProvider === 'local'" class="local-settings">
              <div class="ollama-header">
                <div>
                  <span class="field-label">Ollama 服务</span>
                  <code>{{ settings.ollamaApiBaseUrl }}</code>
                </div>
                <button
                  class="control-button"
                  type="button"
                  :disabled="isOllamaDetecting || isOllamaTesting"
                  @click="detectOllamaModels"
                >
                  {{ isOllamaDetecting ? '检测中...' : '重新检测' }}
                </button>
              </div>

              <div
                v-if="ollamaDetectionResult"
                class="connection-result"
                :class="
                  ollamaDetectionResult.available
                    ? 'connection-result--success'
                    : 'connection-result--error'
                "
                role="status"
              >
                {{ ollamaDetectionResult.message }}
              </div>

              <label class="input-field">
                <span>可用模型</span>
                <select
                  v-model="settings.ollamaModel"
                  :disabled="isOllamaDetecting || ollamaModels.length === 0"
                >
                  <option v-if="ollamaModels.length === 0" value="">暂无可用模型</option>
                  <option v-for="model in ollamaModels" :key="model" :value="model">
                    {{ model }}
                  </option>
                </select>
              </label>

              <label class="input-field">
                <span>测试问题</span>
                <textarea
                  v-model="ollamaTestQuestion"
                  rows="3"
                  maxlength="1000"
                  :disabled="!ollamaDetectionResult?.available || ollamaModels.length === 0"
                ></textarea>
              </label>

              <div class="ollama-test-footer">
                <button
                  class="control-button"
                  type="button"
                  :disabled="
                    !settings.ollamaModel ||
                    isOllamaDetecting ||
                    isOllamaTesting ||
                    isSettingsSaving
                  "
                  @click="testLocalQuestion"
                >
                  {{ isOllamaTesting ? '问答中...' : '测试一次问答' }}
                </button>
              </div>

              <div
                v-if="ollamaQuestionResult"
                class="connection-result"
                :class="
                  ollamaQuestionResult.success
                    ? 'connection-result--success'
                    : 'connection-result--error'
                "
                role="status"
              >
                <strong>{{ ollamaQuestionResult.message }}</strong>
                <p v-if="ollamaQuestionResult.answer">{{ ollamaQuestionResult.answer }}</p>
              </div>
            </div>

            <div v-else class="online-settings">
              <label class="input-field">
                <span>API Base URL</span>
                <input
                  v-model="settings.onlineApiBaseUrl"
                  type="url"
                  maxlength="2048"
                  autocomplete="url"
                  :disabled="!isSettingsLoaded"
                />
              </label>

              <label class="input-field">
                <span>模型名称</span>
                <input
                  v-model="settings.model"
                  type="text"
                  maxlength="120"
                  autocomplete="off"
                  :disabled="!isSettingsLoaded"
                />
              </label>

              <label class="input-field">
                <span>请求超时（毫秒）</span>
                <input
                  v-model.number="settings.onlineRequestTimeoutMs"
                  type="number"
                  min="5000"
                  max="300000"
                  step="1000"
                  :disabled="!isSettingsLoaded"
                />
              </label>

              <label class="input-field">
                <span>API Key</span>
                <input
                  v-model="apiKeyInput"
                  type="password"
                  maxlength="8192"
                  autocomplete="new-password"
                  :placeholder="
                    settings.hasOnlineApiKey ? '已安全保存，输入新值可替换' : '输入 API Key'
                  "
                  :disabled="!isSettingsLoaded"
                />
                <small class="key-status">
                  {{ settings.hasOnlineApiKey ? '已加密保存，不会回显' : '尚未保存 API Key' }}
                </small>
              </label>

              <div
                v-if="connectionTestResult"
                class="connection-result"
                :class="connectionTestResult.success ? 'connection-result--success' : 'connection-result--error'"
                role="status"
              >
                {{ connectionTestResult.message }}
              </div>
            </div>

            </template>

            <div class="settings-footer">
              <span class="settings-message" role="status">{{ settingsMessage }}</span>
              <div class="settings-actions">
                <button
                  v-if="activePage === 'settings' && settings.defaultQaProvider === 'online'"
                  class="control-button"
                  type="button"
                  :disabled="
                    !isSettingsLoaded ||
                    isSettingsSaving ||
                    isConnectionTesting ||
                    isOllamaTesting
                  "
                  @click="testOnlineConnection"
                >
                  {{ isConnectionTesting ? '测试中...' : '测试连接' }}
                </button>
                <button
                  class="control-button control-button--primary"
                  type="submit"
                  :disabled="
                    !isSettingsLoaded ||
                    isSettingsSaving ||
                    isConnectionTesting ||
                    isOllamaTesting ||
                    isOllamaDetecting
                  "
                >
                  {{ isSettingsSaving ? '保存中...' : activePage === 'voice' ? '保存配音设置' : '保存设置' }}
                </button>
              </div>
            </div>
          </form>
        </section>
      </main>
    </div>
  </div>
</template>
