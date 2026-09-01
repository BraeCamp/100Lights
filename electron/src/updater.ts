import { app, dialog, shell, BrowserWindow, Notification } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import log from 'electron-log'
import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * Updates the user can actually see.
 *
 * Every one of these events used to end at `log.info`, so the whole update
 * cycle was invisible: a silent check, a silent background download, and — via
 * `checkForUpdatesAndNotify()` — one stock notification saying a version was
 * "ready to install". Nothing said an update had STARTED (with autoDownload on,
 * that is an unannounced download), nothing offered to restart, nothing
 * confirmed afterwards that the new version had arrived, and a permanently
 * failing updater looked exactly like being up to date.
 *
 * The four moments that matter now each have a surface:
 *
 *   available   → a notification, so a background download is never a surprise
 *   downloading → the dock / taskbar progress bar, which is the one place
 *                 progress belongs: visible if you look, silent if you don't
 *   ready       → a notification that opens a Restart Now / Later dialog
 *   updated     → on the next launch, what changed, from the release notes
 *
 * ⚠️ All of it is native — notifications and dialogs from the main process, no
 * renderer involvement. The window loads 100lights.com, so anything drawn by
 * the web app would depend on a deploy landing in step with the desktop build,
 * would vanish on navigation, and would be missing exactly when the app is in
 * the background, which is when an update lands. See `checkForUpdatesNow` for
 * the one piece that does want a menu item.
 */

/** electron-updater's own notification would duplicate ours — see setup(). */
const FOUR_HOURS = 4 * 60 * 60 * 1000

/**
 * After this many consecutive failed automatic checks, say so once.
 *
 * Silence is the right answer to a single failed check — laptops lose networks
 * constantly and nobody needs to hear about it. It is the wrong answer to an
 * updater that has been broken for a week, which is indistinguishable from
 * being up to date. Three misses is over half a day.
 */
const FAILURES_BEFORE_TELLING = 3

interface UpdateState {
  /** The version that ran last, so a change means an update was installed. */
  lastRunVersion?: string
  /** Captured when the update downloads; read after it installs. */
  pendingNotes?: string
  pendingVersion?: string
}

function stateFile(): string {
  return join(app.getPath('userData'), 'update-state.json')
}

async function readState(): Promise<UpdateState> {
  try {
    return JSON.parse(await fs.readFile(stateFile(), 'utf8')) as UpdateState
  } catch {
    return {}   // first run, or the file was removed — both mean "nothing known"
  }
}

async function writeState(next: UpdateState): Promise<void> {
  try {
    await fs.writeFile(stateFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    // Never fatal: the greeting is a nicety, the update itself does not need it.
    log.error('Could not write update state:', err)
  }
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) { log.info(`(no notifications) ${title}: ${body}`); return }
  const n = new Notification({ title, body, silent: false })
  if (onClick) n.on('click', onClick)
  n.show()
}

/** The window a dialog should hang off, if any is open. */
function anyWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function focusApp(): void {
  const win = anyWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Release notes as plain text.
 *
 * GitHub hands these over as markdown, but electron-updater's type also allows
 * an array of per-version blocks (when several releases are being skipped at
 * once), so both shapes have to be handled or the "what's new" dialog shows
 * "[object Object]".
 */
function notesToText(notes: UpdateInfo['releaseNotes']): string {
  if (!notes) return ''
  const raw = typeof notes === 'string'
    ? notes
    : notes.map(n => n.note ?? '').filter(Boolean).join('\n\n')
  return raw
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')   // block ends are line breaks
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')                 // strip the rest of the markup
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Say what changed, once, on the first launch after an update.
 *
 * ⚠️ A first-ever launch must stay quiet. With no recorded version there is
 * nothing to compare against, and greeting a fresh install with "Updated to
 * 0.5.2" is a lie about something the user just did deliberately.
 */
async function announceIfUpdated(): Promise<void> {
  const state = await readState()
  const current = app.getVersion()

  if (state.lastRunVersion && state.lastRunVersion !== current) {
    log.info(`Updated: ${state.lastRunVersion} -> ${current}`)
    // Notes are only meaningful if they were captured for THIS version — a
    // stale pending block from an abandoned download would describe the wrong
    // release.
    const notes = state.pendingVersion === current ? (state.pendingNotes ?? '') : ''
    notify(
      `Updated to ${current}`,
      notes ? 'Click to see what changed.' : `100Lights is now running version ${current}.`,
      () => {
        focusApp()
        if (!notes) return
        void dialog.showMessageBox(anyWindow()!, {
          type: 'info',
          title: "What's new",
          message: `100Lights ${current}`,
          detail: notes,
          buttons: ['OK'],
        })
      },
    )
  }

  await writeState({ lastRunVersion: current })
}

// ── Check plumbing ──────────────────────────────────────────────────────────

let checking = false
let consecutiveFailures = 0
let toldAboutFailures = false
/** Versions already announced, so the 4-hourly re-check does not repeat itself. */
const announced = new Set<string>()

async function runCheck(manual: boolean): Promise<void> {
  // A manual check landing on top of the automatic one would report "up to
  // date" from the wrong result, so callers queue rather than overlap.
  if (checking) { log.info('Update check already in progress'); return }
  checking = true
  try {
    const result = await autoUpdater.checkForUpdates()
    consecutiveFailures = 0
    if (manual && !result?.downloadPromise) {
      await dialog.showMessageBox(anyWindow()!, {
        type: 'info',
        title: 'No updates',
        message: "You're up to date",
        detail: `100Lights ${app.getVersion()} is the latest version.`,
        buttons: ['OK'],
      })
    }
  } catch (err) {
    consecutiveFailures++
    log.error(`Update check failed (${consecutiveFailures} in a row):`, err)
    if (manual) {
      await dialog.showMessageBox(anyWindow()!, {
        type: 'warning',
        title: 'Could not check for updates',
        message: 'Could not check for updates',
        detail: `${String(err)}\n\n100Lights will keep trying in the background.`,
        buttons: ['OK'],
      })
    } else if (consecutiveFailures >= FAILURES_BEFORE_TELLING && !toldAboutFailures) {
      // Once per session. A broken updater is worth one mention, not a nag.
      toldAboutFailures = true
      notify(
        'Updates are not reaching 100Lights',
        `The last ${consecutiveFailures} checks failed. You may need to download the latest version manually.`,
        () => void shell.openExternal('https://100lights.com/download'),
      )
    }
  } finally {
    checking = false
  }
}

/**
 * A user-initiated check, for a "Check for Updates…" menu item.
 *
 * Not wired to the menu here on purpose: `watchWindowsForMenu` rebuilds the
 * whole application menu whenever a window is focused, closed or renamed, so an
 * item injected from this file would be wiped within 50ms. It belongs in the
 * template in menu.ts:
 *
 *     { label: 'Check for Updates…', click: () => void checkForUpdatesNow() }
 */
export function checkForUpdatesNow(): Promise<void> {
  return runCheck(true)
}

/** Dock (macOS) / taskbar (Windows) progress. -1 removes the bar. */
function setProgress(fraction: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.setProgressBar(fraction) } catch { /* window went away mid-download */ }
  }
}

export function setupUpdater(isDev: boolean): void {
  if (isDev) {
    log.info('Auto-updater disabled in dev mode')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  void announceIfUpdated()

  autoUpdater.on('checking-for-update', () => log.info('Checking for update...'))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('Update available:', info.version)
    if (announced.has(info.version)) return
    announced.add(info.version)
    notify(
      'Update available',
      `100Lights ${info.version} is downloading in the background. You'll be told when it's ready.`,
      focusApp,
    )
  })

  autoUpdater.on('update-not-available', () => log.info('Up to date'))

  autoUpdater.on('download-progress', (p) => {
    log.info(`Download: ${Math.round(p.percent)}%`)
    setProgress(p.percent / 100)
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('Update downloaded:', info.version)
    setProgress(-1)

    // Held for the greeting on the next launch — after the install there is no
    // other way back to what this version changed.
    void readState().then(s => writeState({
      ...s,
      pendingVersion: info.version,
      pendingNotes: notesToText(info.releaseNotes),
    }))

    notify(
      'Update ready',
      `100Lights ${info.version} will install when you quit. Click to restart now.`,
      () => {
        focusApp()
        void dialog.showMessageBox(anyWindow()!, {
          type: 'question',
          title: 'Restart to update',
          message: `Restart to finish updating to ${info.version}?`,
          detail: 'Unsaved work in open projects will not be saved automatically.',
          buttons: ['Restart Now', 'Later'],
          defaultId: 1,      // Later — restarting is never the safe default
          cancelId: 1,
        }).then(({ response }) => {
          if (response !== 0) return
          // isSilent false so the installer surfaces its own errors rather than
          // failing invisibly; the update is already downloaded either way.
          autoUpdater.quitAndInstall(false, true)
        })
      },
    )
  })

  autoUpdater.on('error', (err) => log.error('Auto-update error:', err))

  // ⚠️ checkForUpdates(), NOT checkForUpdatesAndNotify(): the latter shows its
  // own stock "A new update is ready to install" notification on top of the one
  // above, so the user would get the same news twice with different wording.
  void runCheck(false)
  setInterval(() => void runCheck(false), FOUR_HOURS)
}
