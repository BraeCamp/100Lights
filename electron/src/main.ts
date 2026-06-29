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

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
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

  mainWindow = new BrowserWindow({
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

  // Avoid white flash on load
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
    log.info('Window ready')
  })

  // Block keyboard zoom shortcuts (Cmd/Ctrl +/-)
  // The DAW manages zoom internally per-canvas; OS-level zoom breaks the layout
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && ['+', '-', '=', '0'].includes(input.key)) {
      event.preventDefault()
    }
  })

  // Keep zoom factor at 1 if something else tries to change it
  mainWindow.webContents.on('zoom-changed', (_e, dir) => {
    if (dir === 'in' || dir === 'out') {
      mainWindow?.webContents.setZoomFactor(1)
    }
  })

  // Handle new-window requests (links with target="_blank", Clerk OAuth popups, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Stripe checkout → always system browser for security
    if (isExternalPayment(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    // OAuth providers → allow as a constrained popup so the callback
    // redirects back to 100lights.com within Electron, completing the flow
    if (isOAuthProvider(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      }
    }

    // Internal app links (Clerk UI, dashboard redirects) → open in main window
    if (isInternal(url)) {
      mainWindow?.loadURL(url)
      return { action: 'deny' }
    }

    // Anything else (docs, external links) → system browser
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Prevent navigating away from the app domain
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL(APP_URL)
  log.info('Loaded', APP_URL)
}

// Single-instance enforcement — second launch focuses the existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    setupIpc()
    await createWindow()
    if (mainWindow) {
      setupMenu(mainWindow, isDev)
      setupUpdater(isDev)
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// macOS: re-create window when dock icon is clicked and no windows exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
