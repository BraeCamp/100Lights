// ============================================================================
//  Supervises the Beacon Bridge — the helper process that hosts real Audio
//  Unit and VST3 plug-ins.
//
//  The renderer talks to the bridge directly over a WebSocket on loopback,
//  exactly as the browser build does; the only thing the desktop app adds is
//  making sure it is running. That keeps one code path for both, so a bug in
//  plug-in hosting cannot be true in the app and false on the web.
//
//  It is started lazily. Someone who never opens a plug-in never has a second
//  process, and quitting the app takes the bridge with it.
// ============================================================================

import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import log from 'electron-log'

const BRIDGE_APP_NAME = 'Beacon Bridge.app'
const BRIDGE_BINARY = 'Beacon Bridge'

let child: ChildProcess | null = null
let lastError = ''

/** Where the bridge writes its port and token when it starts. */
function discoveryFile(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', '100Lights', 'Beacon', 'bridge.json')
  }
  return path.join(app.getPath('appData'), '100Lights', 'Beacon', 'bridge.json')
}

/** Packaged: alongside the app's resources. Development: the CMake build. */
function resolveBridgeExecutable(): string | null {
  const candidates: string[] = []

  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, BRIDGE_APP_NAME, 'Contents', 'MacOS', BRIDGE_BINARY),
      path.join(process.resourcesPath, 'bridge', BRIDGE_APP_NAME, 'Contents', 'MacOS', BRIDGE_BINARY),
      path.join(process.resourcesPath, BRIDGE_BINARY),
    )
  } else {
    const repo = path.resolve(__dirname, '..', '..')
    candidates.push(
      path.join(repo, 'bridge', 'build', 'BeaconBridge_artefacts', 'Release',
                BRIDGE_APP_NAME, 'Contents', 'MacOS', BRIDGE_BINARY),
      path.join(repo, 'bridge', 'build', 'BeaconBridge_artefacts', 'Debug',
                BRIDGE_APP_NAME, 'Contents', 'MacOS', BRIDGE_BINARY),
    )
  }

  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

export interface BridgeStatus {
  installed: boolean
  running: boolean
  port: number | null
  version: string | null
  error: string
}

export function getBridgeStatus(): BridgeStatus {
  const executable = resolveBridgeExecutable()

  let port: number | null = null
  let version: string | null = null
  let discovered = false

  try {
    const file = discoveryFile()
    if (existsSync(file)) {
      const info = JSON.parse(readFileSync(file, 'utf8')) as { port?: number; version?: string; pid?: number }
      port = info.port ?? null
      version = info.version ?? null

      // The file outlives a crash, so confirm the process is actually there
      // rather than reporting a bridge that is not running.
      if (typeof info.pid === 'number') {
        try { process.kill(info.pid, 0); discovered = true } catch { discovered = false }
      }
    }
  } catch (err) {
    log.warn('[bridge] could not read the discovery file:', err)
  }

  return {
    installed: executable != null,
    running: discovered || (child != null && !child.killed),
    port,
    version,
    error: lastError,
  }
}

export function startBridge(): BridgeStatus {
  const status = getBridgeStatus()
  if (status.running) return status

  const executable = resolveBridgeExecutable()
  if (!executable) {
    lastError = 'The Beacon Bridge helper is not installed with this build.'
    log.warn('[bridge]', lastError)
    return getBridgeStatus()
  }

  try {
    lastError = ''
    child = spawn(executable, [], {
      // Detached would outlive the app; we want it to go when we go.
      detached: false,
      stdio: 'ignore',
    })

    child.on('exit', (code, signal) => {
      log.info(`[bridge] exited (code ${String(code)}, signal ${String(signal)})`)
      child = null
    })

    child.on('error', (err) => {
      lastError = err.message
      log.error('[bridge] failed to start:', err)
      child = null
    })

    log.info('[bridge] started from', executable)
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    log.error('[bridge] could not spawn:', err)
  }

  return getBridgeStatus()
}

export function stopBridge(): void {
  if (child && !child.killed) {
    log.info('[bridge] stopping')
    child.kill()
  }
  child = null
}

/** Called from the app's will-quit handler so no helper is left behind. */
export function disposeBridge(): void {
  stopBridge()
}
