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

function openProjectWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#0d0d14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
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

  win.once('ready-to-show', () => {
    win.show()
    if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  })

  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (isExternalPayment(u)) { shell.openExternal(u); return { action: 'deny' } }
    if (isOAuthProvider(u)) { return { action: 'allow', overrideBrowserWindowOptions: oauthPopupOptions } }
    if (isInternal(u)) { win.loadURL(u); return { action: 'deny' } }
    shell.openExternal(u)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, u) => {
    if (!isInternal(u)) {
      event.preventDefault()
      shell.openExternal(u)
      return
    }
    const { pathname } = new URL(u)
    // "← Home" / "← Dashboard" from inside a project → surface the launcher
    // and close this window so there's no orphaned project window in the background.
    if (pathname === '/dashboard' || pathname === '/launcher') {
      event.preventDefault()
      launcherWindow?.show()
      launcherWindow?.focus()
      win.close()
    }
  })

  void win.loadURL(url)
  log.info('Opening project window:', url)
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

  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalPayment(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    if (isOAuthProvider(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: oauthPopupOptions }
    }
    // Internal links load in the launcher window
    if (isInternal(url)) {
      launcherWindow?.loadURL(url)
      return { action: 'deny' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  launcherWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault()
      shell.openExternal(url)
      return
    }

    const { pathname } = new URL(url)

    // New project form and existing projects open in a dedicated window
    if (pathname === '/new' || /^\/projects\/[^/]+$/.test(pathname)) {
      event.preventDefault()
      openProjectWindow(url)
      return
    }

    // Navigating into a module — expand the launcher window to editor size
    if (pathname.startsWith('/apps/')) {
      launcherWindow!.setResizable(true)
      launcherWindow!.setMinimumSize(1080, 640)
      const [w, h] = launcherWindow!.getSize()
      if (w < 1080 || h < 640) {
        launcherWindow!.setSize(1440, 900, true)
        launcherWindow!.center()
      }
      return
    }

    // Returning to launcher — restore compact size
    if (pathname === '/launcher') {
      launcherWindow!.setMinimumSize(960, 600)
      launcherWindow!.setSize(960, 600, true)
      launcherWindow!.setResizable(false)
      launcherWindow!.center()
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
