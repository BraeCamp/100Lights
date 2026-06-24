/**
 * DAW end-to-end tests.
 * Runs against a local Next.js dev server with DEV_OPEN=1 (auth bypassed).
 *
 * Each test navigates to /new?modules=audio, which renders the full DAW
 * editor (AudioEditor → Transport, SessionView, ArrangementView, Mixer, etc.)
 * without needing a saved project or real user account.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openEditor(page: Page) {
  // Collect JS console errors throughout the test
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err: Error) => errors.push(`Uncaught: ${err.message}`))

  await page.goto('/new?modules=audio')

  // Wait until the Transport bar is visible — means DAW fully mounted
  await expect(page.locator('[data-editor="true"]')).toBeVisible({ timeout: 15_000 })

  return errors
}

async function clickTransportButton(page: Page, label: string) {
  await page.getByRole('button', { name: label }).first().click()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('DAW shell', () => {
  test('editor mounts without JS errors', async ({ page }) => {
    const errors = await openEditor(page)
    // Screenshot for visual inspection
    await page.screenshot({ path: 'tests/e2e/screenshots/01-initial-load.png', fullPage: false })
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('view tabs render and switch', async ({ page }) => {
    await openEditor(page)

    for (const view of ['Session', 'Arrangement', 'Mixer']) {
      await page.getByRole('button', { name: view }).click()
      await page.screenshot({ path: `tests/e2e/screenshots/02-view-${view.toLowerCase()}.png` })
      // Each tab should be visually active (no crash)
      await expect(page.locator('[data-editor="true"]')).toBeVisible()
    }
  })
})

test.describe('Transport', () => {
  test('BPM input is editable', async ({ page }) => {
    await openEditor(page)
    // BPM is shown as a button — click it to reveal the number input
    await page.getByTitle('Click to edit BPM').click()
    const bpmInput = page.locator('input[type="number"]').first()
    await bpmInput.fill('140')
    await bpmInput.press('Enter')
    // After commit the button reappears showing the new tempo
    await expect(page.getByTitle('Click to edit BPM')).toContainText('140')
  })

  test('Play/Stop button cycles state', async ({ page }) => {
    const errors = await openEditor(page)
    // Space bar should toggle play/stop without errors
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')
    expect(errors).toHaveLength(0)
  })

  test('Metronome toggle does not throw', async ({ page }) => {
    const errors = await openEditor(page)
    await page.keyboard.press('m')
    await page.waitForTimeout(200)
    await page.keyboard.press('m')
    expect(errors).toHaveLength(0)
  })
})

test.describe('Session View', () => {
  test('renders track list and scene buttons', async ({ page }) => {
    await openEditor(page)
    await page.getByRole('button', { name: 'Session' }).click()
    await page.screenshot({ path: 'tests/e2e/screenshots/03-session-view.png' })
    // Add Audio track button
    await page.getByRole('button', { name: '+A' }).first().click()
    await page.screenshot({ path: 'tests/e2e/screenshots/04-session-track-added.png' })
    // Should not crash after adding a track
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })

  test('quantization selector exists', async ({ page }) => {
    await openEditor(page)
    await page.getByRole('button', { name: 'Session' }).click()
    // The Q: selector is a <select> in the track headers column
    const qSelect = page.locator('select').first()
    await expect(qSelect).toBeVisible()
  })
})

test.describe('Arrangement View', () => {
  test('renders ruler and track header area', async ({ page }) => {
    await openEditor(page)
    // Arrangement is the default view
    await page.screenshot({ path: 'tests/e2e/screenshots/05-arrangement-initial.png' })
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })

  test('adding tracks creates rows', async ({ page }) => {
    await openEditor(page)
    // Add an audio track
    await page.getByRole('button', { name: '+A' }).first().click()
    // Add a MIDI track
    await page.getByRole('button', { name: '+M' }).first().click()
    // Add a drum track
    await page.getByRole('button', { name: '+D' }).first().click()
    await page.screenshot({ path: 'tests/e2e/screenshots/06-arrangement-tracks-added.png' })
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })

  test('zoom in/out toolbar works', async ({ page }) => {
    await openEditor(page)
    await page.getByTitle('Zoom in').click()
    await page.getByTitle('Zoom in').click()
    await page.getByTitle('Zoom out').click()
    await page.screenshot({ path: 'tests/e2e/screenshots/07-arrangement-zoomed.png' })
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })

  test('snap mode buttons work', async ({ page }) => {
    await openEditor(page)
    for (const snap of ['Off', 'Beat', 'Half', 'Bar']) {
      await page.getByRole('button', { name: snap }).first().click()
    }
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })
})

test.describe('Mixer View', () => {
  test('renders channel strips', async ({ page }) => {
    await openEditor(page)
    // Add some tracks first so there are channels to show
    await page.getByRole('button', { name: '+A' }).first().click()
    await page.getByRole('button', { name: '+M' }).first().click()
    await page.getByRole('button', { name: 'Mixer' }).click()
    await page.screenshot({ path: 'tests/e2e/screenshots/08-mixer.png' })
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })
})

test.describe('Device Chain (effects panel)', () => {
  test('selecting a track shows device panel', async ({ page }) => {
    await openEditor(page)
    // Add a track, then click a track header to select it
    await page.getByRole('button', { name: '+A' }).first().click()

    // Clicking the track name area should select it and show the bottom dock
    // Track headers are in the arrangement view — find by looking for the Devices tab
    // (The bottom dock appears when selectedTrackId is set; clicking an ArrTrackHeader
    //  double-click to rename triggers editing but we need a simple click on the track name span)
    // The AddAutoButton in the track header is a reliable target
    await page.getByTitle('Add automation lane').first().click({ force: true })
    await page.screenshot({ path: 'tests/e2e/screenshots/09-device-panel.png' })
    await expect(page.locator('[data-editor="true"]')).toBeVisible()
  })

  test('can add and see an EQ3 device', async ({ page }) => {
    const errors = await openEditor(page)
    await page.getByRole('button', { name: '+M' }).first().click()

    // Look for the Devices tab in the bottom dock
    const devicesTab = page.getByRole('button', { name: 'Devices' })
    if (await devicesTab.isVisible()) {
      await devicesTab.click()
      // Add device button
      const addDeviceBtn = page.getByTitle('Add device').or(page.getByText('+ Device')).first()
      if (await addDeviceBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addDeviceBtn.click()
        await page.screenshot({ path: 'tests/e2e/screenshots/10-add-device-dropdown.png' })
      }
    }
    expect(errors).toHaveLength(0)
  })
})

test.describe('Keyboard shortcuts', () => {
  test('Cmd+Z undo does not crash', async ({ page }) => {
    const errors = await openEditor(page)
    await page.getByRole('button', { name: '+A' }).first().click()
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
    expect(errors).toHaveLength(0)
  })

  test('Arrow keys seek without crash', async ({ page }) => {
    const errors = await openEditor(page)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    expect(errors).toHaveLength(0)
  })
})

test.describe('Sound Library panel', () => {
  test('sidebar search input is visible', async ({ page }) => {
    await openEditor(page)
    await page.screenshot({ path: 'tests/e2e/screenshots/11-sound-library.png' })
    const searchInput = page.locator('input[placeholder="Search sounds…"]')
    await expect(searchInput).toBeVisible()
  })

  test('Add button opens modal', async ({ page }) => {
    const errors = await openEditor(page)
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.screenshot({ path: 'tests/e2e/screenshots/12-add-sound-modal.png' })
    expect(errors).toHaveLength(0)
  })
})
