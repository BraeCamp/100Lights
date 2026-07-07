import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe, typed API to the renderer (web app) via window.electronAPI.
// Nothing from Node or Electron is accessible directly — all calls go through
// the IPC bridge defined here and handled in ipc.ts on the main side.

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenFileOptions {
  filters?: FileFilter[]
  multiple?: boolean
  title?: string
}

export interface SaveFileOptions {
  defaultPath?: string
  filters?: FileFilter[]
  title?: string
}

export interface ElectronAPI {
  // Native file dialogs — enhancement over <input type="file">
  openFileDialog: (options?: OpenFileOptions) => Promise<string[] | null>
  saveFileDialog: (options?: SaveFileOptions) => Promise<string | null>

  // Shell utilities
  showItemInFolder: (filePath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>

  // Multi-window module management
  openModule: (moduleKey: string) => Promise<void>
  focusModule: (moduleKey: string) => Promise<void>
  showLauncher: () => Promise<void>

  // System audio capture — returns screen source IDs for getUserMedia
  getDesktopSources: () => Promise<Array<{ id: string; name: string }>>

  // App metadata
  platform: NodeJS.Platform
  appVersion: string
  isElectron: true
}

const electronAPI: ElectronAPI = {
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDesktopSources: () => ipcRenderer.invoke('desktopCapturer:getSources'),
  openModule: (moduleKey) => ipcRenderer.invoke('module:open', moduleKey),
  focusModule: (moduleKey) => ipcRenderer.invoke('module:focus', moduleKey),
  showLauncher: () => ipcRenderer.invoke('launcher:show'),
  platform: process.platform,
  appVersion: ipcRenderer.sendSync('app:version') as string,
  isElectron: true,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
