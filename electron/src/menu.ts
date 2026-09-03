import { Menu, app, shell, BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * One menu item per open window, numbered and focusable.
 *
 * The main window is always first so Cmd-1 means "the studio", however many
 * panels are floating.
 */
function panelItems(main: BrowserWindow): MenuItemConstructorOptions[] {
  const windows = [main, ...BrowserWindow.getAllWindows().filter(w => w !== main)]
  return windows.slice(0, 9).map((w, i) => ({
    label: i === 0 ? '100Lights Studio' : (w.getTitle() || `Panel ${i}`),
    accelerator: `CmdOrCtrl+${i + 1}`,
    type: 'checkbox' as const,
    checked: w.isFocused(),
    click: () => { if (w.isMinimized()) w.restore(); w.focus() },
  }))
}

export function setupMenu(win: BrowserWindow, isDev: boolean): void {
  const isMac = process.platform === 'darwin'

  /**
   * Ask the web app to do something.
   *
   * ⚠️ One channel for every menu item, rather than executeJavaScript. The old
   * nav() set `window.location.href`, which is a FULL PAGE LOAD — a new
   * JavaScript context that throws away the layout and everything living in it,
   * Light included. Every File-menu item was quietly ending the voice session.
   *
   * The renderer answers with the client router and falls back to a hard
   * navigation only when nothing is listening.
   */
  const send = (command: string, arg?: unknown) => () =>
    win.webContents.send('menu:command', { command, arg })

  const nav = (path: string) => send('navigate', path)

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu (app name)
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: nav('/create'),
        },
        {
          label: 'All Projects',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: nav('/projects'),
        },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+D',
          click: nav('/dashboard'),
        },
        { type: 'separator' },
        // The studio's own actions. They do nothing outside the editor and say
        // so there — a greyed-out menu item that cannot explain itself is worse
        // than one that answers.
        {
          label: 'Save a Version…',
          accelerator: 'CmdOrCtrl+S',
          click: send('save-version'),
        },
        {
          label: 'Export Audio…',
          accelerator: 'CmdOrCtrl+E',
          click: send('export-audio'),
        },
        {
          label: 'Import…',
          accelerator: 'CmdOrCtrl+I',
          click: send('import'),
        },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const }]
          : [{ role: 'quit' as const }]),
      ],
    },

    {
      label: 'Edit',
      submenu: [
        // ⚠️ The DAW keeps its own history — the browser's undo knows about text
        // fields and nothing about a song. The stock roles stayed here for a
        // long time and looked right while doing the wrong thing entirely.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        // Intentionally no Zoom In/Zoom Out — the DAW controls its own zoom
        { role: 'togglefullscreen' },
        ...(isDev
          ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]
          : []),
      ],
    },

    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
        { type: 'separator' as const },
        // ── Every panel that has left the window ───────────────────────────
        //
        // ⚠️ Built from the REAL windows rather than from anything the web app
        // reports. A popped-out panel IS a BrowserWindow, so the main process
        // already knows its title and whether it is focused — asking the
        // renderer would mean two lists that can disagree, and the one people
        // see would be the stale one.
        //
        // Numbered, because a menu of panels you have to read is a menu you
        // stop using. Cmd-1 is the studio and the rest follow.
        ...panelItems(win),
        { type: 'separator' as const },
        {
          label: 'Close All Panels',
          // Deliberately not Cmd-W, which closes the focused window and is what
          // people expect it to do. Closing eight panels by accident is not a
          // thing anybody should be one keystroke away from.
          click: () => {
            for (const w of BrowserWindow.getAllWindows()) {
              if (w !== win) w.close()
            }
          },
        },
      ],
    },

    {
      label: 'Help',
      submenu: [
        {
          label: 'Send Feedback',
          click: () => shell.openExternal('mailto:feedback@100lights.com?subject=Feedback'),
        },
        {
          label: 'Report a Bug',
          click: () => shell.openExternal('mailto:feedback@100lights.com?subject=Bug%20Report'),
        },
        { type: 'separator' },
        {
          label: 'Privacy Policy',
          click: () => shell.openExternal('https://100lights.com/legal/privacy'),
        },
        {
          label: 'Terms of Service',
          click: () => shell.openExternal('https://100lights.com/legal/terms'),
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'About 100Lights',
                click: () => app.showAboutPanel(),
              },
            ]
          : []),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Keep the Window menu honest.
 *
 * ⚠️ A menu built once lists the windows that existed at startup — which, for a
 * feature whose whole point is opening and closing panels, is a menu that is
 * wrong the moment anybody uses it. Rebuilt whenever a window appears, goes, or
 * takes focus (the checkmark tracks focus).
 *
 * Debounced because focus events arrive in pairs — one window blurs as another
 * focuses — and rebuilding the application menu twice per click is visible as a
 * flicker on macOS.
 */
export function watchWindowsForMenu(main: BrowserWindow, isDev: boolean): void {
  let pending: NodeJS.Timeout | null = null
  const rebuild = () => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => { pending = null; setupMenu(main, isDev) }, 50)
  }
  const attach = (w: BrowserWindow) => {
    w.on('focus', rebuild)
    w.on('closed', rebuild)
    w.on('page-title-updated', rebuild)
  }
  attach(main)
  app.on('browser-window-created', (_e, w) => { attach(w); rebuild() })
}
