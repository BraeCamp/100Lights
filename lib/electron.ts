// Type declarations and helpers for when the web app runs inside Electron.
// In the browser, window.electronAPI is undefined — all helpers gracefully
// fall back to the standard web equivalents.

export interface ElectronFileFilter {
  name: string
  extensions: string[]
}

export interface ElectronAPI {
  openFileDialog: (options?: {
    filters?: ElectronFileFilter[]
    multiple?: boolean
    title?: string
  }) => Promise<string[] | null>
  saveFileDialog: (options?: {
    defaultPath?: string
    filters?: ElectronFileFilter[]
    title?: string
  }) => Promise<string | null>
  showItemInFolder: (filePath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  platform: 'darwin' | 'win32' | 'linux'
  appVersion: string
  isElectron: true
  // Launcher / module window management
  openModule: (moduleKey: string) => Promise<void>
  focusModule: (moduleKey: string) => Promise<void>
  showLauncher: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// True when running inside the Electron desktop app.
export const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// Open a native file picker if in Electron, otherwise return null so the
// caller can fall back to a hidden <input type="file">.
export async function nativeOpenFile(options?: {
  filters?: ElectronFileFilter[]
  multiple?: boolean
  title?: string
}): Promise<string[] | null> {
  return window.electronAPI?.openFileDialog(options) ?? null
}

// Save a native file picker if in Electron, otherwise return null.
export async function nativeSaveFile(options?: {
  defaultPath?: string
  filters?: ElectronFileFilter[]
  title?: string
}): Promise<string | null> {
  return window.electronAPI?.saveFileDialog(options) ?? null
}

// Reveal a file in Finder / Explorer. No-op in the browser.
export function revealInFolder(filePath: string): void {
  window.electronAPI?.showItemInFolder(filePath)
}

// Open a module in its own window (Electron), or navigate to its app page (browser).
export function openModule(moduleKey: string, router?: { push: (href: string) => void }): void {
  if (window.electronAPI) {
    void window.electronAPI.openModule(moduleKey)
  } else {
    router?.push(`/apps/${moduleKey}`)
  }
}

// Bring the launcher window back into focus (Electron only).
export function showLauncher(): void {
  window.electronAPI?.showLauncher()
}
