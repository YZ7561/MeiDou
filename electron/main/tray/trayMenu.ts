import { Menu, Tray, app, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import {
  allowPetWindowClose,
  hidePetWindow,
  savePetWindowPosition,
  setPetSleepMode,
  showPetWindow,
  togglePetWindowAlwaysOnTop
} from '../window/petWindow'
import { loadConfig, loadQaConfig, saveQaConfig } from '../storage/configStore'
import type { QaProviderName } from '../qa/qaTypes'

let tray: Tray | null = null
let isAlwaysOnTop = true

const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAxElEQVR4AWP4//8/AyWYYXQwYGRkZGJgYGD4z8DAwMDA8J+BgYGBgeE/AwMDw38GBgYGhv8MDAwMDAx/GJgYGBhYgQgwMjIyMpz+/fv3/8+fP/9nYGD4z8DAwMDA8J+BgeE/AwPDfwYGBob/DJgYGRlZGJgYGBh+MDAwMDAw/GdgYGD4z8DAwMDA8J8BMTAwMDD8Z2BgeM/AwPDfwYGBob/DJgYGRkZGBgYGBh+MDAwMDAw/GdgYGD4z8DAwMAAAFX7MvF8MgTaAAAAAElFTkSuQmCC'

export function createTrayMenu(): Tray {
  const image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)

  isAlwaysOnTop = loadConfig().alwaysOnTop
  tray = new Tray(image)
  tray.setToolTip('MeiDou 桌宠')
  updateTrayMenu()
  tray.on('double-click', () => showPetWindow())

  return tray
}

export function destroyTrayMenu(): void {
  tray?.destroy()
  tray = null
}

export function refreshTrayMenu(): void {
  isAlwaysOnTop = loadConfig().alwaysOnTop
  updateTrayMenu()
}

function updateTrayMenu(): void {
  if (!tray) return

  const qaConfig = loadQaConfig()
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示桌宠',
      click: () => showPetWindow()
    },
    {
      label: '隐藏桌宠',
      click: () => hidePetWindow()
    },
    {
      label: isAlwaysOnTop ? '取消置顶' : '开启置顶',
      click: () => {
        isAlwaysOnTop = togglePetWindowAlwaysOnTop()
        updateTrayMenu()
      }
    },
    {
      label: '睡觉模式',
      click: () => setPetSleepMode()
    },
    {
      label: '问答来源',
      submenu: createQaProviderMenuItems(qaConfig.provider)
    },
    { type: 'separator' },
    {
      label: '退出应用',
      click: () => {
        allowPetWindowClose()
        savePetWindowPosition()
        destroyTrayMenu()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

function createQaProviderMenuItems(currentProvider: QaProviderName): MenuItemConstructorOptions[] {
  return [
    createQaProviderMenuItem('Mock 本地规则', 'mock', currentProvider),
    createQaProviderMenuItem('在线模型 API', 'online', currentProvider),
    createQaProviderMenuItem('Local 本地模型，占位', 'local', currentProvider)
  ]
}

function createQaProviderMenuItem(
  label: string,
  provider: QaProviderName,
  currentProvider: QaProviderName
): MenuItemConstructorOptions {
  return {
    label,
    type: 'radio',
    checked: provider === currentProvider,
    click: () => {
      saveQaConfig({ provider })
      updateTrayMenu()
    }
  }
}
