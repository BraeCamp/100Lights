import { Menu, app, shell, BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export function setupMenu(win: BrowserWindow, isDev: boolean): void {
  const isMac = process.platform === 'darwin'

  // Helper: navigate within the app
  const nav = (path: string) => () =>
    win.webContents.executeJavaScript(`window.location.href = '${path}'`)

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
          click: nav('/new'),
        },
        {
          label: 'All Projects',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: nav('/projects'),
        },
        { type: 'separator' },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+D',
          click: nav('/dashboard'),
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
        { role: 'undo' },
        { role: 'redo' },
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
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
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
