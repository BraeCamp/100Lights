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


// ── Offline handling ───────────────────────────────────────────────────────────
// The app shell is loaded from the remote URL, so with no connection a window
// would sit blank (ready-to-show never fires). Instead we swap in a local
// offline page with a retry button, and auto-retry when the network comes back.

function offlinePageUrl(retryUrl: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>100Lights</title><style>
    html,body{margin:0;height:100%;background:#0d0d14;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-app-region:drag}
    .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:0 32px}
    h1{font-size:20px;font-weight:700;margin:0}
    p{font-size:13px;color:#9a9aa5;margin:0;max-width:420px;line-height:1.6}
    button{-webkit-app-region:no-drag;margin-top:6px;font-size:13px;font-weight:600;padding:9px 22px;border-radius:8px;border:1px solid #3d8fef;background:rgba(61,143,239,.15);color:#7ab5f7;cursor:pointer}
    button:hover{background:rgba(61,143,239,.25)}
    .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;margin-right:6px}
  </style></head><body><div class="wrap">
    <h1><span class="dot"></span>You&rsquo;re offline</h1>
    <p>100Lights couldn&rsquo;t reach the server. Check your internet connection &mdash; the app will reconnect automatically, or you can retry now.</p>
    <button onclick="retry()">Retry</button>
  </div><script>
    const target = ${JSON.stringify(retryUrl)}
    function retry(){ location.href = target }
    window.addEventListener('online', retry)
    setInterval(() => { if (navigator.onLine) retry() }, 10000)
  <\/script></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function attachOfflineHandler(win: BrowserWindow, fallbackUrl: () => string): void {
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED: fired by intercepted/cancelled navigations, not real failures
    if (!isMainFrame || errorCode === -3) return
    const retryUrl = validatedURL && isInternal(validatedURL) ? validatedURL : fallbackUrl()
    log.warn('Main-frame load failed', errorCode, errorDescription, validatedURL, '— showing offline page')
    void win.loadURL(offlinePageUrl(retryUrl))
  })
}

// Notify the renderer when a window enters/leaves fullscreen so it can drop
// the traffic-light padding (macOS hides the lights with the menu bar).
function wireFullScreenEvents(win: BrowserWindow): void {
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-changed', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-changed', false))
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
  wireFullScreenEvents(win)
  attachOfflineHandler(win, () => `${APP_URL}/apps/${moduleKey}`)
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
    fullscreenable: true,
    resizable: true,
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

  wireFullScreenEvents(win)
  attachOfflineHandler(win, () => url)
  void win.loadURL(url)
  log.info('Opening project window:', url)
}

async function createLauncherWindow(): Promise<void> {
  // Grant mic + camera permission to the app — required for getUserMedia in the renderer.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'camera', 'audioCapture', 'desktopCapture']
    callback(allowed.includes(permission))
  })

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
    minWidth: 720,
    minHeight: 480,
    resizable: true,
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
      launcherWindow!.setMinimumSize(1080, 640)
      const [w, h] = launcherWindow!.getSize()
      if (w < 1080 || h < 640) {
        launcherWindow!.setSize(1440, 900, true)
        launcherWindow!.center()
      }
      return
    }

    // Returning to launcher — restore compact size (stays resizable)
    if (pathname === '/launcher') {
      launcherWindow!.setMinimumSize(720, 480)
      if (!launcherWindow!.isFullScreen()) {
        launcherWindow!.setSize(960, 600, true)
        launcherWindow!.center()
      }
    }
  })

  // Intercept Next.js client-side navigation (history.pushState) to project/new pages.
  // will-navigate only fires for full-page navigations; pushState bypasses it.
  let interceptingNav = false
  launcherWindow.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame || interceptingNav) return
    let pathname: string
    try { pathname = new URL(url).pathname } catch { return }
    if (pathname === '/new' || /^\/projects\/[^/]+$/.test(pathname)) {
      interceptingNav = true
      openProjectWindow(url)
      launcherWindow!.webContents.goBack()
      setTimeout(() => { interceptingNav = false }, 500)
    }
  })

  launcherWindow.on('closed', () => {
    launcherWindow = null
  })

  wireFullScreenEvents(launcherWindow)
  attachOfflineHandler(launcherWindow, () => `${APP_URL}/launcher`)
  // loadURL rejects when offline — did-fail-load above swaps in the offline page,
  // so don't let the rejection abort launcher setup (menu, updater)
  await launcherWindow.loadURL(`${APP_URL}/launcher`).catch(err => {
    log.warn('Launcher initial load failed (offline?)', String(err))
  })
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
  ipcMain.handle('window:isFullScreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
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
