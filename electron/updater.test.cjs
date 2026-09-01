/**
 * The update notifications, driven against a stubbed Electron.
 *
 *     cd electron && npm run build && node updater.test.cjs
 *
 * None of updater.ts is reachable any other way: it returns early in dev mode,
 * and the paths that matter fire on a real download from a real GitHub release
 * — days apart, on someone else's machine. So `electron`, `electron-updater`
 * and `electron-log` are swapped out at the module loader, which lets the four
 * moments (available / downloading / ready / updated) be triggered on demand
 * and the notifications and dialogs be read back as data.
 *
 * ⚠️ These assertions were checked by BREAKING the code, not just by passing:
 * deleting the `announced` dedupe guard turns "an available update is
 * announced" and "a NEW version is announced again" red. A test that cannot
 * fail is not evidence of anything.
 */
const Module = require('module')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const UPDATER = path.join(__dirname, 'dist', 'updater.js')
const origLoad = Module._load
let stubs = {}
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
  return origLoad.call(this, request, ...rest)
}

let passed = 0, failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++ }
  catch (e) { console.log(`FAIL ${name}\n     ${e.message}`); failed++ }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeEnv({ version, userData }) {
  const notifications = []
  const dialogs = []
  const progress = []
  let dialogResponse = 1

  class Notification {
    static isSupported() { return true }
    constructor(opts) { this.opts = opts; this.handlers = {} }
    on(ev, fn) { this.handlers[ev] = fn; return this }
    show() { notifications.push(this) }
    click() { this.handlers.click && this.handlers.click() }
  }
  const win = {
    isMinimized: () => false, restore() {}, show() {}, focus() {},
    setProgressBar: v => progress.push(v),
  }
  const electron = {
    app: { getVersion: () => version, getPath: () => userData },
    dialog: {
      showMessageBox: (_w, opts) => { dialogs.push(opts); return Promise.resolve({ response: dialogResponse }) },
    },
    shell: { openExternal: () => Promise.resolve() },
    BrowserWindow: { getFocusedWindow: () => win, getAllWindows: () => [win] },
    Notification,
  }
  const autoUpdater = new EventEmitter()
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.quitAndInstall = () => { autoUpdater.quitCalled = true }
  autoUpdater._impl = () => Promise.resolve(null)
  autoUpdater.checkForUpdates = () => autoUpdater._impl()
  const log = { info() {}, error() {}, warn() {} }

  stubs = { electron, 'electron-updater': { autoUpdater }, 'electron-log': log }
  delete require.cache[UPDATER]
  const mod = require(UPDATER)
  return { mod, autoUpdater, notifications, dialogs, progress,
           setDialogResponse: r => { dialogResponse = r } }
}

const tmpUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'))
const readState = d => JSON.parse(fs.readFileSync(path.join(d, 'update-state.json'), 'utf8'))

;(async () => {
  // ── 1. A fresh install must not claim to be an update ────────────────────
  {
    const dir = tmpUserData()
    const env = makeEnv({ version: '0.5.2', userData: dir })
    env.mod.setupUpdater(false)
    await sleep(30)
    check('first ever launch says nothing', () =>
      assert.strictEqual(env.notifications.filter(n => /Updated to/.test(n.opts.title)).length, 0))
    check('first launch records the version', () =>
      assert.strictEqual(readState(dir).lastRunVersion, '0.5.2'))
  }

  // ── 2. A real upgrade greets, with the notes it saved ────────────────────
  {
    const dir = tmpUserData()
    fs.writeFileSync(path.join(dir, 'update-state.json'), JSON.stringify({
      lastRunVersion: '0.5.1', pendingVersion: '0.5.2', pendingNotes: 'Faster loading.',
    }))
    const env = makeEnv({ version: '0.5.2', userData: dir })
    env.mod.setupUpdater(false)
    await sleep(30)
    const n = env.notifications.find(n => /Updated to/.test(n.opts.title))
    check('an upgrade is announced', () => assert.ok(n, 'no Updated notification'))
    check('it names the new version', () => assert.match(n.opts.title, /0\.5\.2/))
    check('it offers the notes', () => assert.match(n.opts.body, /what changed/i))
    n.click()
    await sleep(20)
    check('clicking shows the release notes', () => {
      const d = env.dialogs.find(d => /new/i.test(d.title))
      assert.ok(d, 'no notes dialog'); assert.match(d.detail, /Faster loading/)
    })
    check('the version is rolled forward', () =>
      assert.strictEqual(readState(dir).lastRunVersion, '0.5.2'))
  }

  // ── 3. Notes from an abandoned download must not be shown ────────────────
  {
    const dir = tmpUserData()
    fs.writeFileSync(path.join(dir, 'update-state.json'), JSON.stringify({
      lastRunVersion: '0.5.0', pendingVersion: '0.9.9', pendingNotes: 'Notes for a build never installed.',
    }))
    const env = makeEnv({ version: '0.5.2', userData: dir })
    env.mod.setupUpdater(false)
    await sleep(30)
    const n = env.notifications.find(n => /Updated to/.test(n.opts.title))
    check('a stale pending block is ignored', () => assert.doesNotMatch(n.opts.body, /what changed/i))
    n.click()
    await sleep(20)
    check('and shows no notes dialog', () =>
      assert.strictEqual(env.dialogs.filter(d => /new/i.test(d.title)).length, 0))
  }

  // ── 4. Availability is announced once, not every four hours ──────────────
  {
    const env = makeEnv({ version: '0.5.2', userData: tmpUserData() })
    env.mod.setupUpdater(false)
    await sleep(20)
    env.autoUpdater.emit('update-available', { version: '0.6.0' })
    env.autoUpdater.emit('update-available', { version: '0.6.0' })
    env.autoUpdater.emit('update-available', { version: '0.6.0' })
    const avail = env.notifications.filter(n => n.opts.title === 'Update available')
    check('an available update is announced', () => assert.strictEqual(avail.length, 1))
    check('the notification names the version', () => assert.match(avail[0].opts.body, /0\.6\.0/))
    env.autoUpdater.emit('update-available', { version: '0.7.0' })
    check('but a NEW version is announced again', () =>
      assert.strictEqual(env.notifications.filter(n => n.opts.title === 'Update available').length, 2))
  }

  // ── 5. Progress, then the restart offer ──────────────────────────────────
  {
    const dir = tmpUserData()
    const env = makeEnv({ version: '0.5.2', userData: dir })
    env.mod.setupUpdater(false)
    await sleep(20)
    env.autoUpdater.emit('download-progress', { percent: 42 })
    check('download drives the dock progress bar', () =>
      assert.deepStrictEqual(env.progress, [0.42]))
    env.autoUpdater.emit('update-downloaded', {
      version: '0.6.0', releaseNotes: '<p>Two things</p><ul><li>One</li><li>Two</li></ul>',
    })
    await sleep(30)
    check('the bar is cleared when it lands', () => assert.strictEqual(env.progress.at(-1), -1))
    const ready = env.notifications.find(n => n.opts.title === 'Update ready')
    check('a ready update is announced', () => assert.ok(ready))
    check('notes are saved for after the install', () => {
      const s = readState(dir)
      assert.strictEqual(s.pendingVersion, '0.6.0')
      assert.match(s.pendingNotes, /Two things/)
      assert.doesNotMatch(s.pendingNotes, /<p>|<li>/)
      assert.match(s.pendingNotes, /• One/)
    })
    check('the greeting version is not clobbered', () =>
      assert.strictEqual(readState(dir).lastRunVersion, '0.5.2'))

    env.setDialogResponse(1)               // "Later"
    ready.click(); await sleep(20)
    check('Later does not restart', () => assert.ok(!env.autoUpdater.quitCalled))
    const d = env.dialogs.find(x => /Restart to update/.test(x.title))
    check('Later is the default button', () => assert.strictEqual(d.defaultId, 1))

    env.setDialogResponse(0)               // "Restart Now"
    ready.click(); await sleep(20)
    check('Restart Now installs', () => assert.ok(env.autoUpdater.quitCalled))
  }

  // ── 6. A broken updater is not silent forever ────────────────────────────
  {
    const env = makeEnv({ version: '0.5.2', userData: tmpUserData() })
    env.autoUpdater._impl = () => Promise.reject(new Error('ENOTFOUND'))
    env.mod.setupUpdater(false)
    await sleep(30)
    const failNote = () => env.notifications.filter(n => /not reaching/i.test(n.opts.title))
    check('one failed check is not worth mentioning', () =>
      assert.strictEqual(failNote().length, 0))
    env.dialogs.length = 0
    await env.mod.checkForUpdatesNow()
    check('a manual check reports the failure', () =>
      assert.ok(env.dialogs.find(d => /Could not check/.test(d.title))))
  }

  // ── 7. Manual check on a healthy, up-to-date app ─────────────────────────
  {
    const env = makeEnv({ version: '0.5.2', userData: tmpUserData() })
    env.mod.setupUpdater(false)
    await sleep(20)
    env.dialogs.length = 0
    await env.mod.checkForUpdatesNow()
    check('manual check says you are up to date', () =>
      assert.ok(env.dialogs.find(d => /up to date/i.test(d.message))))
  }

  // ── 8. Several skipped releases arrive as an array ───────────────────────
  {
    const dir = tmpUserData()
    const env = makeEnv({ version: '0.5.2', userData: dir })
    env.mod.setupUpdater(false)
    await sleep(20)
    env.autoUpdater.emit('update-downloaded', {
      version: '0.7.0',
      releaseNotes: [{ version: '0.6.0', note: '<p>Older</p>' }, { version: '0.7.0', note: '<p>Newer</p>' }],
    })
    await sleep(30)
    check('every skipped release is included, as text', () => {
      const s = readState(dir)
      assert.match(s.pendingNotes, /Older/); assert.match(s.pendingNotes, /Newer/)
      assert.doesNotMatch(s.pendingNotes, /object Object/)
    })
  }

  console.log(`\n${passed} passing, ${failed} failing`)
  process.exit(failed ? 1 : 0)
})()
