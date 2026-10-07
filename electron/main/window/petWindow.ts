import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/ipcChannels'
import {
  AppConfig,
  loadConfig,
  saveAlwaysOnTop,
  savePetState,
  saveWindowBounds
} from '../storage/configStore'

const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 280

let petWindow: BrowserWindow | null = null
let isQuitting = false
let shouldShowPetWindow = true

export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow
  }

  petWindow = null
  const config = loadConfig()
  const bounds = getInitialBounds(config)

  petWindow = new BrowserWindow({
    ...bounds,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  petWindow.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    petWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  petWindow.once('ready-to-show', () => {
    if (shouldShowPetWindow) {
      petWindow?.show()
    }
  })

  petWindow.on('show', () => {
    notifyPetWindowVisibility()
  })

  petWindow.on('hide', () => {
    notifyPetWindowVisibility()
  })

  petWindow.on('moved', () => {
    savePetWindowPosition()
  })

  petWindow.on('close', (event) => {
    if (isQuitting) return

    event.preventDefault()
    shouldShowPetWindow = false
    petWindow?.hide()
  })

  petWindow.on('closed', () => {
    petWindow = null
    notifyPetWindowVisibility()
  })

  return petWindow
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

export function showPetWindow(): void {
  shouldShowPetWindow = true
  const window = createPetWindow()

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
}

export function hidePetWindow(): void {
  shouldShowPetWindow = false
  petWindow?.hide()
}

export function getPetWindowVisibility(): 'running' | 'hidden' {
  return petWindow && !petWindow.isDestroyed() && petWindow.isVisible() ? 'running' : 'hidden'
}

export function allowPetWindowClose(): void {
  isQuitting = true
}

export function togglePetWindowAlwaysOnTop(): boolean {
  if (!petWindow || petWindow.isDestroyed()) return false

  const nextAlwaysOnTop = !petWindow.isAlwaysOnTop()
  petWindow.setAlwaysOnTop(nextAlwaysOnTop, 'screen-saver')
  saveAlwaysOnTop(nextAlwaysOnTop)
  return nextAlwaysOnTop
}

export function applyPetWindowAlwaysOnTop(alwaysOnTop: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return

  petWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
}

export function setPetSleepMode(): void {
  if (!petWindow || petWindow.isDestroyed()) return

  savePetState('sleep')
  petWindow.webContents.send(IPC_CHANNELS.PET_SET_STATE, 'sleep')
}

export function savePetWindowPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return

  const bounds = petWindow.getBounds()
  saveWindowBounds(bounds)
}

function getInitialBounds(config: AppConfig): Electron.Rectangle {
  const savedBounds = config.window

  if (savedBounds && isBoundsVisible(savedBounds)) {
    return {
      x: savedBounds.x,
      y: savedBounds.y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT
    }
  }

  const display = screen.getPrimaryDisplay()
  const { workArea } = display

  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: workArea.x + workArea.width - DEFAULT_WIDTH - 40,
    y: workArea.y + workArea.height - DEFAULT_HEIGHT - 40
  }
}

function isBoundsVisible(bounds: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const horizontalVisible = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
    const verticalVisible = bounds.y < area.y + area.height && bounds.y + bounds.height > area.y

    return horizontalVisible && verticalVisible
  })
}

function notifyPetWindowVisibility(): void {
  const visibility = getPetWindowVisibility()

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.PET_WINDOW_VISIBILITY_CHANGED, visibility)
    }
  }
}
