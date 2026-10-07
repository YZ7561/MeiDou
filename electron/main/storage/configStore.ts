import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_OLLAMA_API_BASE_URL,
  DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
  DEFAULT_ONLINE_API_BASE_URL,
  DEFAULT_ONLINE_API_MODEL,
  DEFAULT_ONLINE_REQUEST_TIMEOUT_MS
} from '../qa/qaTypes'
import type {
  LocalQaConfig,
  MockQaRule,
  OnlineQaConfig,
  QaConfig,
  QaProviderName
} from '../qa/qaTypes'
import { cloneDefaultMockQaRules, validateMockQaRules } from '../qa/mockRules'
import { hasStoredOnlineApiKey } from './secretStore'

export type PetState = 'idle' | 'happy' | 'sleep'
export type VoiceEngine = 'system'
export type RagEmbeddingProviderName = 'online' | 'local'

export interface OnlineRagEmbeddingConfig {
  apiBaseUrl: string
  model: string
  requestTimeoutMs: number
}

export interface LocalRagEmbeddingConfig {
  model?: string
  requestTimeoutMs?: number
}

export interface RagEmbeddingConfig {
  provider: RagEmbeddingProviderName
  online?: OnlineRagEmbeddingConfig
  local?: LocalRagEmbeddingConfig
}

export interface VoiceConfig {
  enabled: boolean
  autoSpeakAnswer: boolean
  engine: VoiceEngine
  rate: number
  volume: number
  pitch: number
  voiceName: string
}

export interface AppConfig {
  window: Electron.Rectangle
  autoShowPetOnLaunch: boolean
  alwaysOnTop: boolean
  longMemoryEnabled: boolean
  ragEnabled: boolean
  petState: PetState
  qa: QaConfig
  ragEmbedding: RagEmbeddingConfig
  voice: VoiceConfig
}

export interface ManagementConfig {
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

export interface ResolvedOnlineQaConfig {
  apiBaseUrl: string
  model: string
  requestTimeoutMs: number
}

export interface ResolvedOllamaQaConfig {
  apiBaseUrl: string
  model?: string
}

export type ResolvedRagEmbeddingConfig =
  | {
      provider: 'online'
      apiBaseUrl: string
      model: string
      requestTimeoutMs: number
    }
  | {
      provider: 'local'
      apiBaseUrl: string
      model?: string
      requestTimeoutMs: number
    }

const CONFIG_FILE = 'config.json'
const DEFAULT_ONLINE_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_QA_CONFIG: QaConfig = {
  provider: 'mock',
  mockRules: cloneDefaultMockQaRules()
}
const DEFAULT_RAG_EMBEDDING_CONFIG: RagEmbeddingConfig = {
  provider: 'online'
}
const DEFAULT_CONFIG: AppConfig = {
  window: {
    x: 0,
    y: 0,
    width: 320,
    height: 360
  },
  autoShowPetOnLaunch: true,
  alwaysOnTop: true,
  longMemoryEnabled: true,
  ragEnabled: true,
  petState: 'idle',
  qa: { ...DEFAULT_QA_CONFIG },
  ragEmbedding: cloneRagEmbeddingConfig(DEFAULT_RAG_EMBEDDING_CONFIG),
  voice: {
    enabled: false,
    autoSpeakAnswer: true,
    engine: 'system',
    rate: 1,
    volume: 1,
    pitch: 1,
    voiceName: ''
  }
}

export function loadConfig(): AppConfig {
  const filePath = getConfigPath()

  if (!existsSync(filePath)) {
    saveConfig(DEFAULT_CONFIG)
    return {
      ...DEFAULT_CONFIG,
      window: { ...DEFAULT_CONFIG.window },
      qa: cloneQaConfig(DEFAULT_CONFIG.qa),
      ragEmbedding: cloneRagEmbeddingConfig(DEFAULT_CONFIG.ragEmbedding),
      voice: { ...DEFAULT_CONFIG.voice }
    }
  }

  try {
    const data: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))

    if (isRecord(data)) {
      return normalizeConfig(data)
    }
  } catch {
  }

  return cloneDefaultConfig()
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(normalizeConfig(config), null, 2), 'utf-8')
}

export function saveWindowBounds(bounds: Electron.Rectangle): void {
  const config = loadConfig()
  config.window = {
    x: bounds.x,
    y: bounds.y,
    width: 320,
    height: 360
  }
  saveConfig(config)
}

export function saveAlwaysOnTop(alwaysOnTop: boolean): void {
  const config = loadConfig()
  config.alwaysOnTop = alwaysOnTop
  saveConfig(config)
}

export function savePetState(petState: PetState): void {
  const config = loadConfig()
  config.petState = petState
  saveConfig(config)
}

export function isLongMemoryEnabled(): boolean {
  return loadConfig().longMemoryEnabled
}

export function isRagEnabled(): boolean {
  return loadConfig().ragEnabled
}

export function saveRagEnabled(ragEnabled: boolean): ManagementConfig {
  const config = loadConfig()
  config.ragEnabled = ragEnabled
  saveConfig(config)
  return toManagementConfig(config)
}

export function loadQaConfig(): QaConfig {
  return loadConfig().qa
}

export function loadMockQaRules(): MockQaRule[] {
  return loadQaConfig().mockRules.map((rule) => ({ ...rule }))
}

export function saveMockQaRules(value: unknown): MockQaRule[] {
  const validation = validateMockQaRules(value)
  if (!validation.valid) {
    throw new Error(validation.message)
  }

  const config = loadConfig()
  config.qa.mockRules = validation.rules
  saveConfig(config)
  return loadMockQaRules()
}

export function restoreDefaultMockQaRules(): MockQaRule[] {
  return saveMockQaRules(cloneDefaultMockQaRules())
}

export function loadResolvedOnlineQaConfig(): ResolvedOnlineQaConfig {
  return resolveOnlineQaConfig(loadQaConfig())
}

export function loadResolvedOllamaQaConfig(): ResolvedOllamaQaConfig {
  const qaConfig = loadQaConfig()

  return {
    apiBaseUrl: resolveOllamaApiBaseUrl(),
    model:
      qaConfig.local?.model ??
      normalizeText(process.env.OLLAMA_MODEL) ??
      normalizeText(process.env.LOCAL_LLM_MODEL)
  }
}

export function loadRagEmbeddingConfig(): RagEmbeddingConfig {
  return cloneRagEmbeddingConfig(loadConfig().ragEmbedding)
}

export function loadResolvedRagEmbeddingConfig(): ResolvedRagEmbeddingConfig {
  const config = loadConfig()

  return resolveRagEmbeddingConfig(config.ragEmbedding, config.qa)
}

export function saveRagEmbeddingConfig(ragEmbedding: Partial<RagEmbeddingConfig>): void {
  const config = loadConfig()
  config.ragEmbedding = normalizeRagEmbeddingConfig(
    {
      ...config.ragEmbedding,
      ...ragEmbedding
    },
    config.qa
  )
  saveConfig(config)
}

export function saveQaConfig(qa: Partial<QaConfig>): void {
  const config = loadConfig()
  config.qa = normalizeQaConfig({ ...config.qa, ...qa })
  saveConfig(config)
}

export function saveQaModel(model: string): boolean {
  const normalizedModel = normalizeQaModelForSave(model)

  if (!normalizedModel) {
    return false
  }

  const config = loadConfig()
  config.qa.model = normalizedModel
  saveConfig(config)
  return true
}

export function loadManagementConfig(): ManagementConfig {
  return toManagementConfig(loadConfig())
}

export function saveManagementConfig(settings: unknown): ManagementConfig {
  const config = loadConfig()

  if (isRecord(settings)) {
    if (typeof settings.autoShowPetOnLaunch === 'boolean') {
      config.autoShowPetOnLaunch = settings.autoShowPetOnLaunch
    }

    if (typeof settings.alwaysOnTop === 'boolean') {
      config.alwaysOnTop = settings.alwaysOnTop
    }

    if (typeof settings.longMemoryEnabled === 'boolean') {
      config.longMemoryEnabled = settings.longMemoryEnabled
    }

    const provider = parseQaProviderName(settings.defaultQaProvider)
    if (provider) {
      config.qa.provider = provider
    }

    const model = normalizeQaModelForSave(settings.model)
    if (model) {
      config.qa.model = model
    }

    const apiBaseUrl = normalizeOnlineApiBaseUrlForSave(settings.onlineApiBaseUrl)
    const requestTimeoutMs = normalizeRequestTimeout(settings.onlineRequestTimeoutMs)

    if (apiBaseUrl || requestTimeoutMs) {
      config.qa.online = {
        apiBaseUrl: apiBaseUrl ?? config.qa.online?.apiBaseUrl ?? DEFAULT_ONLINE_API_BASE_URL,
        requestTimeoutMs:
          requestTimeoutMs ??
          config.qa.online?.requestTimeoutMs ??
          DEFAULT_ONLINE_REQUEST_TIMEOUT_MS
      }
    }

    const ollamaModel = normalizeQaModelForSave(settings.ollamaModel)
    if (ollamaModel) {
      config.qa.local = { model: ollamaModel }
    }

    if (isRecord(settings.voice)) {
      config.voice = normalizeVoiceConfig({
        ...config.voice,
        ...settings.voice
      })
    }
  }

  saveConfig(config)
  return toManagementConfig(config)
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

function normalizeConfig(config: unknown): AppConfig {
  const value = isRecord(config) ? config : {}
  const qa = normalizeQaConfig(value.qa)

  return {
    window: normalizeWindowBounds(value.window),
    autoShowPetOnLaunch:
      typeof value.autoShowPetOnLaunch === 'boolean'
        ? value.autoShowPetOnLaunch
        : DEFAULT_CONFIG.autoShowPetOnLaunch,
    alwaysOnTop:
      typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : DEFAULT_CONFIG.alwaysOnTop,
    longMemoryEnabled:
      typeof value.longMemoryEnabled === 'boolean'
        ? value.longMemoryEnabled
        : DEFAULT_CONFIG.longMemoryEnabled,
    ragEnabled:
      typeof value.ragEnabled === 'boolean' ? value.ragEnabled : DEFAULT_CONFIG.ragEnabled,
    petState: isValidPetState(value.petState) ? value.petState : DEFAULT_CONFIG.petState,
    qa,
    ragEmbedding: normalizeRagEmbeddingConfig(value.ragEmbedding, qa),
    voice: normalizeVoiceConfig(value.voice)
  }
}

function cloneDefaultConfig(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    window: { ...DEFAULT_CONFIG.window },
    qa: cloneQaConfig(DEFAULT_CONFIG.qa),
    ragEmbedding: cloneRagEmbeddingConfig(DEFAULT_CONFIG.ragEmbedding),
    voice: { ...DEFAULT_CONFIG.voice }
  }
}

function toManagementConfig(config: AppConfig): ManagementConfig {
  const onlineConfig = resolveOnlineQaConfig(config.qa)

  return {
    autoShowPetOnLaunch: config.autoShowPetOnLaunch,
    alwaysOnTop: config.alwaysOnTop,
    defaultQaProvider: config.qa.provider,
    model: onlineConfig.model,
    onlineApiBaseUrl: onlineConfig.apiBaseUrl,
    onlineRequestTimeoutMs: onlineConfig.requestTimeoutMs,
    hasOnlineApiKey: hasStoredOnlineApiKey(),
    ollamaApiBaseUrl: resolveOllamaApiBaseUrl(),
    ollamaModel: config.qa.local?.model ?? '',
    longMemoryEnabled: config.longMemoryEnabled,
    ragEnabled: config.ragEnabled,
    voice: { ...config.voice }
  }
}

function normalizeVoiceConfig(voice: unknown): VoiceConfig {
  const value = isRecord(voice) ? voice : {}

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.voice.enabled,
    autoSpeakAnswer:
      typeof value.autoSpeakAnswer === 'boolean'
        ? value.autoSpeakAnswer
        : DEFAULT_CONFIG.voice.autoSpeakAnswer,
    engine: value.engine === 'system' ? value.engine : DEFAULT_CONFIG.voice.engine,
    rate: normalizeVoiceNumber(value.rate, DEFAULT_CONFIG.voice.rate, 0.5, 1.5),
    volume: normalizeVoiceNumber(value.volume, DEFAULT_CONFIG.voice.volume, 0, 1),
    pitch: normalizeVoiceNumber(value.pitch, DEFAULT_CONFIG.voice.pitch, 0.5, 1.5),
    voiceName: normalizeVoiceName(value.voiceName)
  }
}

function normalizeVoiceName(voiceName: unknown): string {
  return typeof voiceName === 'string' ? voiceName.trim() : DEFAULT_CONFIG.voice.voiceName
}

function normalizeVoiceNumber(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (value === '') return defaultValue

  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return defaultValue

  return Math.min(Math.max(numberValue, minimum), maximum)
}

function isValidPetState(state: unknown): state is PetState {
  return state === 'idle' || state === 'happy' || state === 'sleep'
}

function normalizeQaConfig(qa: unknown): QaConfig {
  if (!isRecord(qa)) {
    return { ...DEFAULT_QA_CONFIG }
  }

  const model = normalizeQaModelForSave(qa.model)
  const online = normalizeOnlineQaConfig(qa.online)
  const local = normalizeLocalQaConfig(qa.local)
  const mockRulesValidation = validateMockQaRules(qa.mockRules)

  return {
    provider: normalizeQaProviderName(qa.provider),
    mockRules: mockRulesValidation.valid
      ? mockRulesValidation.rules
      : cloneDefaultMockQaRules(),
    ...(model ? { model } : {}),
    ...(online ? { online } : {}),
    ...(local ? { local } : {})
  }
}

function cloneQaConfig(qa: QaConfig): QaConfig {
  return {
    ...qa,
    mockRules: qa.mockRules.map((rule) => ({ ...rule })),
    ...(qa.online ? { online: { ...qa.online } } : {}),
    ...(qa.local ? { local: { ...qa.local } } : {})
  }
}

function normalizeRagEmbeddingConfig(
  ragEmbedding: unknown,
  qaConfig: QaConfig
): RagEmbeddingConfig {
  const value = isRecord(ragEmbedding) ? ragEmbedding : {}
  const provider =
    parseRagEmbeddingProviderName(value.provider) ?? resolveDefaultRagEmbeddingProvider(qaConfig)
  const online = normalizeOnlineRagEmbeddingConfig(value.online)
  const local = normalizeLocalRagEmbeddingConfig(value.local)

  return {
    provider,
    ...(online ? { online } : {}),
    ...(local ? { local } : {})
  }
}

function cloneRagEmbeddingConfig(config: RagEmbeddingConfig): RagEmbeddingConfig {
  return {
    provider: config.provider,
    ...(config.online ? { online: { ...config.online } } : {}),
    ...(config.local ? { local: { ...config.local } } : {})
  }
}

function resolveRagEmbeddingConfig(
  ragEmbedding: RagEmbeddingConfig,
  qaConfig: QaConfig
): ResolvedRagEmbeddingConfig {
  const config = normalizeRagEmbeddingConfig(ragEmbedding, qaConfig)

  if (config.provider === 'local') {
    return {
      provider: 'local',
      apiBaseUrl: resolveOllamaApiBaseUrl(),
      model:
        config.local?.model ??
        normalizeText(process.env.RAG_OLLAMA_EMBEDDING_MODEL) ??
        normalizeText(process.env.OLLAMA_EMBEDDING_MODEL) ??
        normalizeText(process.env.RAG_EMBEDDING_MODEL) ??
        qaConfig.local?.model ??
        normalizeText(process.env.OLLAMA_MODEL) ??
        normalizeText(process.env.LOCAL_LLM_MODEL),
      requestTimeoutMs:
        config.local?.requestTimeoutMs ??
        normalizeRequestTimeout(process.env.RAG_EMBEDDING_TIMEOUT_MS) ??
        DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS
    }
  }

  const onlineConfig = resolveOnlineQaConfig(qaConfig)

  return {
    provider: 'online',
    apiBaseUrl:
      config.online?.apiBaseUrl ??
      normalizeText(process.env.RAG_ONLINE_EMBEDDING_API_BASE_URL) ??
      normalizeText(process.env.RAG_EMBEDDING_API_BASE_URL) ??
      onlineConfig.apiBaseUrl,
    model:
      config.online?.model ??
      normalizeText(process.env.RAG_ONLINE_EMBEDDING_MODEL) ??
      normalizeText(process.env.ONLINE_EMBEDDING_MODEL) ??
      normalizeText(process.env.OPENAI_EMBEDDING_MODEL) ??
      normalizeText(process.env.RAG_EMBEDDING_MODEL) ??
      DEFAULT_ONLINE_EMBEDDING_MODEL,
    requestTimeoutMs:
      config.online?.requestTimeoutMs ??
      normalizeRequestTimeout(process.env.RAG_EMBEDDING_TIMEOUT_MS) ??
      onlineConfig.requestTimeoutMs
  }
}

function normalizeOnlineRagEmbeddingConfig(
  online: unknown
): OnlineRagEmbeddingConfig | undefined {
  if (!isRecord(online)) return undefined

  const apiBaseUrl = normalizeOnlineApiBaseUrlForSave(online.apiBaseUrl)
  const model = normalizeQaModelForSave(online.model)
  const requestTimeoutMs = normalizeRequestTimeout(online.requestTimeoutMs)
  if (!apiBaseUrl && !model && !requestTimeoutMs) return undefined

  return {
    apiBaseUrl: apiBaseUrl ?? DEFAULT_ONLINE_API_BASE_URL,
    model: model ?? DEFAULT_ONLINE_EMBEDDING_MODEL,
    requestTimeoutMs: requestTimeoutMs ?? DEFAULT_ONLINE_REQUEST_TIMEOUT_MS
  }
}

function normalizeLocalRagEmbeddingConfig(local: unknown): LocalRagEmbeddingConfig | undefined {
  if (!isRecord(local)) return undefined

  const model = normalizeQaModelForSave(local.model)
  const requestTimeoutMs = normalizeRequestTimeout(local.requestTimeoutMs)
  if (!model && !requestTimeoutMs) return undefined

  return {
    ...(model ? { model } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {})
  }
}

function resolveDefaultRagEmbeddingProvider(qaConfig: QaConfig): RagEmbeddingProviderName {
  return qaConfig.provider === 'local' ? 'local' : DEFAULT_RAG_EMBEDDING_CONFIG.provider
}

function parseRagEmbeddingProviderName(provider: unknown): RagEmbeddingProviderName | undefined {
  return provider === 'online' || provider === 'local' ? provider : undefined
}

function normalizeQaProviderName(provider: unknown): QaProviderName {
  return parseQaProviderName(provider) ?? DEFAULT_QA_CONFIG.provider
}

function parseQaProviderName(provider: unknown): QaProviderName | undefined {
  if (provider === 'openai') return 'online'
  if (provider === 'mock' || provider === 'online' || provider === 'local') return provider

  return undefined
}

function normalizeQaModelForSave(model: unknown): string | undefined {
  if (typeof model !== 'string') return undefined

  const normalizedModel = model.trim()
  if (!normalizedModel || normalizedModel.length > 120) return undefined

  return normalizedModel
}

function normalizeOnlineQaConfig(online: unknown): OnlineQaConfig | undefined {
  if (!isRecord(online)) return undefined

  const apiBaseUrl = normalizeOnlineApiBaseUrlForSave(online.apiBaseUrl)
  const requestTimeoutMs = normalizeRequestTimeout(online.requestTimeoutMs)
  if (!apiBaseUrl && !requestTimeoutMs) return undefined

  return {
    apiBaseUrl: apiBaseUrl ?? DEFAULT_ONLINE_API_BASE_URL,
    requestTimeoutMs: requestTimeoutMs ?? DEFAULT_ONLINE_REQUEST_TIMEOUT_MS
  }
}

function normalizeLocalQaConfig(local: unknown): LocalQaConfig | undefined {
  if (!isRecord(local)) return undefined

  const model = normalizeQaModelForSave(local.model)
  return model ? { model } : undefined
}

function resolveOnlineQaConfig(qaConfig: QaConfig): ResolvedOnlineQaConfig {
  return {
    apiBaseUrl:
      qaConfig.online?.apiBaseUrl ??
      normalizeText(process.env.ONLINE_API_URL) ??
      normalizeText(process.env.ONLINE_API_BASE_URL) ??
      normalizeText(process.env.OPENAI_BASE_URL) ??
      DEFAULT_ONLINE_API_BASE_URL,
    model:
      qaConfig.model ??
      normalizeText(process.env.ONLINE_API_MODEL) ??
      normalizeText(process.env.OPENAI_MODEL) ??
      DEFAULT_ONLINE_API_MODEL,
    requestTimeoutMs:
      qaConfig.online?.requestTimeoutMs ??
      normalizeRequestTimeout(process.env.ONLINE_API_TIMEOUT_MS) ??
      DEFAULT_ONLINE_REQUEST_TIMEOUT_MS
  }
}

function normalizeOnlineApiBaseUrlForSave(value: unknown): string | undefined {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue || normalizedValue.length > 2048) return undefined

  try {
    const url = new URL(normalizedValue)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  } catch {
    return undefined
  }

  return normalizedValue.replace(/\/+$/, '')
}

function normalizeRequestTimeout(value: unknown): number | undefined {
  const timeout = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(timeout) || timeout < 5000 || timeout > 300000) return undefined

  return Math.round(timeout)
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalizedValue = value.trim()
  return normalizedValue || undefined
}

function resolveOllamaApiBaseUrl(): string {
  const configuredUrl =
    normalizeText(process.env.OLLAMA_API_BASE_URL) ??
    normalizeText(process.env.OLLAMA_HOST) ??
    normalizeText(process.env.LOCAL_LLM_URL)
  if (!configuredUrl) return DEFAULT_OLLAMA_API_BASE_URL

  const urlWithProtocol = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `http://${configuredUrl}`

  try {
    const url = new URL(urlWithProtocol)
    const path = url.pathname.replace(/\/+$/, '')
    url.pathname = path.endsWith('/api') ? path : `${path}/api`
    return url.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_OLLAMA_API_BASE_URL
  }
}

function normalizeWindowBounds(bounds: unknown): Electron.Rectangle {
  const value = isRecord(bounds) ? bounds : {}

  return {
    x: getFiniteNumber(value.x, DEFAULT_CONFIG.window.x),
    y: getFiniteNumber(value.y, DEFAULT_CONFIG.window.y),
    width: 320,
    height: 360
  }
}

function getFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
