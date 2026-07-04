import { app, BrowserWindow, shell, session, ipcMain } from 'electron'
import path from 'path'
import log from 'electron-log'
import { setupMenu } from './menu'
import { setupUpdater } from './updater'
import { setupIpc } from './ipc'

log.transports.file.level = 'info'
log.info('100Lights starting', app.getVersion())

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development'
const PROD_URL = 'https://100lights.com'
const DEV_URL = 'http://localhost:3000'
const APP_URL = isDev ? DEV_URL : PROD_URL

// Domains allowed for in-app navigation.
// Everything else opens in the system browser.
const INTERNAL_HOSTS = new Set([
  '100lights.com',
  'www.100lights.com',
  // Clerk hosted UI and OAuth infrastructure
  'clerk.100lights.com',
  'accounts.100lights.com',
  'clerk.shared.lcl.dev',
  // OAuth providers — open as popup so the callback lands back in-app
  'accounts.google.com',
  'github.com',
  // Sentry DSN (data reporting only, no navigation)
])

function isInternal(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    if (isDev && hostname === 'localhost') return true
    return INTERNAL_HOSTS.has(hostname) || hostname.endsWith('.100lights.com')
  } catch {
    return false
  }
}

function isOAuthProvider(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'accounts.google.com' || hostname === 'github.com'
  } catch {
    return false
  }
}

function isExternalPayment(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'checkout.stripe.com' || hostname === 'billing.stripe.com'
  } catch {
    return false
  }
}

// Returns the module key if the URL is an /apps/<moduleKey> path, otherwise null.
function moduleKeyFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url)
    const match = pathname.match(/^\/apps\/([^/]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

const oauthPopupOptions = {
  width: 520,
  height: 680,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
}

let launcherWindow: BrowserWindow | null = null
const moduleWindows = new Map<string, BrowserWindow>()

function openModuleWindow(moduleKey: string): void {
  const existing = moduleWindows.get(moduleKey)
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#0d0d14',
    // Mac: hide title bar, keep traffic lights
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // Start at 1× — ZoomBlock in the renderer also handles pinch/scroll zoom
      zoomFactor: 1.0,
    },
    show: false,
  })

  win.once('ready-to-show', () => {
    win.show()
    if (isDev) win.webContents.openDevTools({ mode: 'detach' })
    log.info('Module window ready:', moduleKey)
  })

  // Block keyboard zoom shortcuts (Cmd/Ctrl +/-)
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && ['+', '-', '=', '0'].includes(input.key)) {
      event.preventDefault()
    }
  })

  // Keep zoom factor at 1 if something else tries to change it
  win.webContents.on('zoom-changed', (_e, dir) => {
    if (dir === 'in' || dir === 'out') {
      win.webContents.setZoomFactor(1)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalPayment(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    if (isOAuthProvider(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: oauthPopupOptions }
    }
    if (isInternal(url)) {
      win.loadURL(url)
      return { action: 'deny' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  win.on('closed', () => {
    moduleWindows.delete(moduleKey)
    log.info('Module window closed:', moduleKey)
  })

  moduleWindows.set(moduleKey, win)
  void win.loadURL(`${APP_URL}/apps/${moduleKey}`)
  log.info('Opening module window:', moduleKey)
}

async function createLauncherWindow(): Promise<void> {
  // Patch COOP/COEP headers so SharedArrayBuffer (used by FFmpeg.wasm) works
  // in Electron. The production server sets these; this ensures they're present
  // in dev and as a safety net.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const res = { ...details.responseHeaders }
    // Only patch the main app responses, not cross-origin CDN assets
    if (isInternal(details.url)) {
      res['Cross-Origin-Opener-Policy'] = ['same-origin']
      res['Cross-Origin-Embedder-Policy'] = ['credentialless']
    }
    callback({ responseHeaders: res })
  })

  launcherWindow = new BrowserWindow({
    width: 960,
    height: 600,
    resizable: false,
    fullscreenable: true,
    center: true,
    backgroundColor: '#0d0d14',
    // Mac: hide title bar, keep traffic lights
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      zoomFactor: 1.0,
    },
    show: false,
  })

  launcherWindow.once('ready-to-show', () => {
    launcherWindow?.show()
    if (isDev) launcherWindow?.webContents.openDevTools({ mode: 'detach' })
    log.info('Launcher window ready')
  })

  // Intercept /apps/* links — open as module windows instead of navigating in-place.
  // This means clicking a module card in the browser version opens a new window in desktop.
  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalPayment(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    if (isOAuthProvider(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: oauthPopupOptions }
    }
    const moduleKey = moduleKeyFromUrl(url)
    if (moduleKey) {
      openModuleWindow(moduleKey)
      return { action: 'deny' }
    }
    // Internal app links (Clerk UI, dashboard redirects) → load in launcher
    if (isInternal(url)) {
      launcherWindow?.loadURL(url)
      return { action: 'deny' }
    }
    // Anything else (docs, external links) → system browser
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Also intercept direct navigations to /apps/* within the launcher
  launcherWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault()
      shell.openExternal(url)
      return
    }
    const moduleKey = moduleKeyFromUrl(url)
    if (moduleKey) {
      event.preventDefault()
      openModuleWindow(moduleKey)
    }
  })

  launcherWindow.on('closed', () => {
    launcherWindow = null
  })

  await launcherWindow.loadURL(`${APP_URL}/launcher`)
  log.info('Loaded launcher', `${APP_URL}/launcher`)
}

// Module-related IPC handlers live here (not ipc.ts) because they need direct
// access to openModuleWindow, moduleWindows, and launcherWindow.
function setupModuleIpc(): void {
  ipcMain.handle('module:open', (_event, moduleKey: string) => {
    openModuleWindow(moduleKey)
  })
  ipcMain.handle('module:focus', (_event, moduleKey: string) => {
    moduleWindows.get(moduleKey)?.focus()
  })
  ipcMain.handle('launcher:show', () => {
    launcherWindow?.show()
    launcherWindow?.focus()
  })
}

// Single-instance enforcement — second launch focuses the launcher
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _argv) => {
    if (launcherWindow) {
      if (launcherWindow.isMinimized()) launcherWindow.restore()
      launcherWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    setupIpc()
    setupModuleIpc()
    await createLauncherWindow()
    if (launcherWindow) {
      setupMenu(launcherWindow, isDev)
      setupUpdater(isDev)
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// macOS: re-create launcher when dock icon is clicked and no windows exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow()
})
