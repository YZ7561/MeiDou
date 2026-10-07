import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

let managementWindow: BrowserWindow | null = null

export function createManagementWindow(): BrowserWindow {
  if (managementWindow && !managementWindow.isDestroyed()) {
    showManagementWindow()
    return managementWindow
  }

  managementWindow = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const managementUrl = new URL('management.html', process.env.ELECTRON_RENDERER_URL)
    managementWindow.loadURL(managementUrl.toString())
  } else {
    managementWindow.loadFile(join(__dirname, '../renderer/management.html'))
  }

  managementWindow.once('ready-to-show', () => {
    managementWindow?.show()
  })

  // Markdown 聊天内容里的 http(s) 链接：用系统默认浏览器打开，避免在应用内导航
  managementWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  managementWindow.webContents.on('will-navigate', (event, url) => {
    if (!isExternalUrl(url)) return
    if (url === managementWindow?.webContents.getURL()) return

    event.preventDefault()
    void shell.openExternal(url)
  })

  managementWindow.on('closed', () => {
    managementWindow = null
  })

  return managementWindow
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

export function showManagementWindow(): void {
  if (!managementWindow || managementWindow.isDestroyed()) {
    createManagementWindow()
    return
  }

  if (managementWindow.isMinimized()) {
    managementWindow.restore()
  }

  managementWindow.show()
  managementWindow.focus()
}
