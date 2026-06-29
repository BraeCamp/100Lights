import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

export function setupUpdater(isDev: boolean): void {
  if (isDev) {
    log.info('Auto-updater disabled in dev mode')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log.info('Checking for update...'))
  autoUpdater.on('update-available', (info) => log.info('Update available:', info.version))
  autoUpdater.on('update-not-available', () => log.info('Up to date'))
  autoUpdater.on('download-progress', (p) => log.info(`Download: ${Math.round(p.percent)}%`))
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version, '— will install on next quit')
  })
  autoUpdater.on('error', (err) => log.error('Auto-update error:', err))

  // Check on startup, then every 4 hours
  autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000)
}
