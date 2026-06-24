/**
 * Exploratory test: loads a real .aif file, puts it on a track, moves it,
 * resizes it, explores MIDI instruments. Captures screenshots at every step.
 */

import { test, expect, type Page } from '@playwright/test'

const AIF_PATH = '/Users/brae/Desktop/Music/Song Examples/Gorillaz Synths Projects - Reverb Exclusive/Gorillaz Synths Projects - Reverb Exclusive/Andromeda Project/Samples/Processed/Consolidate/10 Andromeda (feat. D.R.A.M.).aif'

const allErrors: string[] = []

async function openEditor(page: Page) {
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const t = msg.text()
      // Skip React DevTools noise
      if (!t.includes('Download the React') && !t.includes('[Fast Refresh]') && !t.includes('favicon')) {
        allErrors.push(`[${msg.type()}] ${t}`)
      }
    }
  })
  page.on('pageerror', err => allErrors.push(`[pageerror] ${err.message}`))
  await page.goto('/new?modules=audio')
  await expect(page.locator('[data-editor="true"]')).toBeVisible({ timeout: 15_000 })
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `tests/e2e/screenshots/explore-${name}.png` })
  console.log(`  📸 ${name}`)
}

// ─────────────────────────────────────────────────────────────────────────────

test('explore: aif on track → move → resize → MIDI instruments', async ({ page }) => {
  await openEditor(page)
  await shot(page, '00-initial')

  // ── 1. Add an audio track ─────────────────────────────────────────────────
  await page.getByRole('button', { name: '+A' }).first().click()
  await page.waitForTimeout(400)
  await shot(page, '01-audio-track-added')

  // ── 2. Double-click the audio track lane to open file picker ──────────────
  const audioLane = page.locator('[data-testid="track-lane"][data-track-type="audio"]').first()
  await expect(audioLane).toBeVisible()

  const filechooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 })
  // Click in the left portion of the lane (beat 2-ish) at mid-height
  const laneBox = await audioLane.boundingBox()
  if (!laneBox) throw new Error('audio lane not found')
  await page.mouse.dblclick(laneBox.x + 80, laneBox.y + laneBox.height / 2)

  const fc = await filechooserPromise
  await fc.setFiles(AIF_PATH)
  console.log('  ✓ File chosen:', AIF_PATH.split('/').pop())

  // Wait for decode + waveform render
  await page.waitForTimeout(4000)
  await shot(page, '02-clip-loaded')

  // ── 3. Play briefly ──────────────────────────────────────────────────────
  await page.keyboard.press('Space')
  await page.waitForTimeout(1200)
  await shot(page, '03-playing')
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)

  // ── 4. Move the clip (drag from body) ────────────────────────────────────
  // Clip starts at beat 0 in the lane, default beatW ≈ 50px
  // Drag from x+20 (inside clip) to x+200 (4 beats right)
  const laneBox2 = await audioLane.boundingBox()
  if (!laneBox2) throw new Error('lane gone after play')
  const clipBodyX = laneBox2.x + 20
  const clipBodyY = laneBox2.y + laneBox2.height / 2

  await page.mouse.move(clipBodyX, clipBodyY)
  await page.waitForTimeout(100)
  await page.mouse.down()
  await page.mouse.move(clipBodyX + 200, clipBodyY, { steps: 30 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await shot(page, '04-clip-moved')

  // ── 5. Resize clip smaller (drag right edge left) ─────────────────────────
  // After moving ~200px right, clip starts at ~200px from lane left.
  // Default clip duration = 8 beats × 50px = ~400px. Right edge at ~600px from lane left.
  // We look for the cursor change — just try near the expected right edge.
  const laneBox3 = await audioLane.boundingBox()
  if (!laneBox3) throw new Error('lane gone after move')

  // Approach: use mouse.move to scan for the resize cursor near the right edge of the clip.
  // Clip right edge estimate: laneBox.x + 200 (start after drag) + 400 (default 8-beat clip)
  const clipRightEstX = laneBox3.x + 200 + 400
  const clipMidY      = laneBox3.y + laneBox3.height / 2

  await page.mouse.move(clipRightEstX - 4, clipMidY)
  await page.waitForTimeout(200)
  await shot(page, '05-near-resize-handle')

  await page.mouse.down()
  await page.mouse.move(clipRightEstX - 4 - 150, clipMidY, { steps: 30 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await shot(page, '06-clip-shrunk')

  // ── 6. Expand clip (drag right edge right) ────────────────────────────────
  const clipNewRightX = clipRightEstX - 150
  await page.mouse.move(clipNewRightX - 4, clipMidY)
  await page.waitForTimeout(200)
  await page.mouse.down()
  await page.mouse.move(clipNewRightX + 200, clipMidY, { steps: 30 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await shot(page, '07-clip-expanded')

  // ── 7. Stretch track height taller ───────────────────────────────────────
  // The height resize handle is 4px at the very bottom of the track row.
  const laneBox4 = await audioLane.boundingBox()
  if (!laneBox4) throw new Error('lane gone')
  const resizeY = laneBox4.y + laneBox4.height - 2
  const resizeX = laneBox4.x + 80

  await page.mouse.move(resizeX, resizeY)
  await page.waitForTimeout(100)
  await page.mouse.down()
  await page.mouse.move(resizeX, resizeY + 80, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await shot(page, '08-track-taller')

  // Shrink it back
  const laneBox5 = await audioLane.boundingBox()
  if (laneBox5) {
    const resizeY2 = laneBox5.y + laneBox5.height - 2
    await page.mouse.move(resizeX, resizeY2)
    await page.mouse.down()
    await page.mouse.move(resizeX, resizeY2 - 60, { steps: 20 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    await shot(page, '09-track-shorter')
  }

  // ── 8. Zoom in and out ────────────────────────────────────────────────────
  await page.getByTitle('Zoom in').click()
  await page.getByTitle('Zoom in').click()
  await page.getByTitle('Zoom in').click()
  await shot(page, '10-zoomed-in')
  await page.getByTitle('Zoom out').click()
  await page.getByTitle('Zoom out').click()
  await page.getByTitle('Zoom out').click()
  await shot(page, '11-zoomed-out')

  // ── 9. Add a MIDI track and create a clip ─────────────────────────────────
  await page.getByRole('button', { name: '+M' }).first().click()
  await page.waitForTimeout(300)
  await shot(page, '12-midi-track-added')

  const midiLane = page.locator('[data-testid="track-lane"][data-track-type="midi"]').first()
  await expect(midiLane).toBeVisible()
  const midiBox = await midiLane.boundingBox()
  if (!midiBox) throw new Error('midi lane not found')

  await page.mouse.dblclick(midiBox.x + 80, midiBox.y + midiBox.height / 2)
  await page.waitForTimeout(600)
  await shot(page, '13-midi-clip-created-piano-roll')

  // ── 10. Select MIDI track → check Instrument tab ──────────────────────────
  // Click on the MIDI track header area (left of the lane) to select the track
  await page.mouse.click(midiBox.x - 100, midiBox.y + midiBox.height / 2)
  await page.waitForTimeout(300)
  await shot(page, '14-midi-track-clicked')

  const instrTab = page.getByRole('button', { name: 'Instrument' })
  if (await instrTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await instrTab.click()
    await shot(page, '15-instrument-panel-midi')

    // Try switching to FM synth if it's available
    const fmBtn = page.getByRole('button', { name: /FM/i }).first()
    if (await fmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await fmBtn.click()
      await shot(page, '16-fm-synth-settings')
    }
  } else {
    await shot(page, '15-instrument-panel-not-visible')
  }

  // ── 11. Add Drum track, inspect drum pads ────────────────────────────────
  await page.getByRole('button', { name: '+D' }).first().click()
  await page.waitForTimeout(300)
  await shot(page, '17-drum-track-added')

  const drumLane = page.locator('[data-testid="track-lane"][data-track-type="drum"]').first()
  if (await drumLane.isVisible({ timeout: 1000 }).catch(() => false)) {
    const drumBox = await drumLane.boundingBox()
    if (drumBox) {
      // Select drum track
      await page.mouse.click(drumBox.x - 100, drumBox.y + drumBox.height / 2)
      await page.waitForTimeout(300)
      const instrTab2 = page.getByRole('button', { name: 'Instrument' })
      if (await instrTab2.isVisible({ timeout: 1000 }).catch(() => false)) {
        await instrTab2.click()
        await shot(page, '18-drum-instrument-panel')
      }
    }
  }

  // ── 12. Devices panel — add an EQ3 to the audio track ────────────────────
  // Click in audio track header area to select it
  const audioLaneFinal = page.locator('[data-testid="track-lane"][data-track-type="audio"]').first()
  const audioBoxFinal  = await audioLaneFinal.boundingBox()
  if (audioBoxFinal) {
    await page.mouse.click(audioBoxFinal.x - 100, audioBoxFinal.y + audioBoxFinal.height / 2)
    await page.waitForTimeout(300)
    const devicesTab = page.getByRole('button', { name: 'Devices' })
    if (await devicesTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await devicesTab.click()
      await shot(page, '19-devices-panel-open')

      const addDevice = page.getByTitle('Add device').or(page.getByText('+ Device')).first()
      if (await addDevice.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addDevice.click()
        await shot(page, '20-add-device-dropdown')
        // Click EQ3 if visible
        const eq3btn = page.getByRole('button', { name: /EQ/i }).first()
        if (await eq3btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await eq3btn.click()
          await shot(page, '21-eq3-added')
        }
      }
    }
  }

  // ── 13. Session view with clip ─────────────────────────────────────────────
  await page.getByRole('button', { name: 'Session' }).click()
  await shot(page, '22-session-view-final')

  // ── 14. Mixer ─────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Mixer' }).click()
  await shot(page, '23-mixer-final')

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('\n=== Console output collected ===')
  if (allErrors.length === 0) {
    console.log('  None — clean ✓')
  } else {
    allErrors.forEach(e => console.log(' •', e))
  }
})
