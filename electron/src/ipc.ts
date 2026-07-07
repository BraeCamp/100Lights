import { ipcMain, dialog, shell, app, desktopCapturer } from 'electron'
import type { OpenFileOptions, SaveFileOptions } from './preload'

const AUDIO_FILTER = { name: 'Audio', extensions: ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg', 'opus', 'wma'] }
const VIDEO_FILTER = { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'mxf', 'm4v', 'wmv'] }
const ALL_FILTER   = { name: 'All files', extensions: ['*'] }

export function setupIpc(): void {
  // Open file picker — returns array of selected paths or null if cancelled
  ipcMain.handle('dialog:openFile', async (_event, options: OpenFileOptions = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title ?? 'Open file',
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters ?? [AUDIO_FILTER, VIDEO_FILTER, ALL_FILTER],
    })
    return canceled ? null : filePaths
  })

  // Save file picker — returns chosen path or null if cancelled
  ipcMain.handle('dialog:saveFile', async (_event, options: SaveFileOptions = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: options.title ?? 'Save file',
      defaultPath: options.defaultPath,
      filters: options.filters ?? [ALL_FILTER],
    })
    return canceled ? null : (filePath ?? null)
  })

  // Reveal a file in Finder / Explorer
  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Open a URL in the default system browser
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    return shell.openExternal(url)
  })

  // System audio capture — return screen source IDs so the renderer can call
  // getUserMedia with chromeMediaSource:'desktop' without showing a screen picker
  ipcMain.handle('desktopCapturer:getSources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources.map(s => ({ id: s.id, name: s.name }))
  })

  // Synchronous app version for preload (used before async bridge is ready)
  ipcMain.on('app:version', (event) => {
    event.returnValue = app.getVersion()
  })
}
