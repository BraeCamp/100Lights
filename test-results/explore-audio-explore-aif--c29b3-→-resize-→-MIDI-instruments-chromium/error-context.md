# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: explore-audio.spec.ts >> explore: aif on track → move → resize → MIDI instruments
- Location: tests/e2e/explore-audio.spec.ts:34:5

# Error details

```
Error: Channel closed
```

```
Error: page.waitForTimeout: Test ended.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - button "Rewind to start" [ref=e6] [cursor=pointer]:
        - img [ref=e7]
      - button "Play / Stop (Space)" [ref=e9] [cursor=pointer]:
        - img [ref=e10]
      - button "Record" [ref=e12] [cursor=pointer]:
        - img [ref=e13]
      - button "Toggle loop" [ref=e15] [cursor=pointer]:
        - img [ref=e16]
      - generic [ref=e22]: 1.1.1
      - generic [ref=e24]:
        - button "120" [ref=e25] [cursor=pointer]
        - generic [ref=e26]: BPM
        - button "TAP" [ref=e27] [cursor=pointer]
      - button "4/4" [ref=e29] [cursor=pointer]
      - button "Toggle metronome (M)" [ref=e31] [cursor=pointer]:
        - img [ref=e32]
      - generic [ref=e36]:
        - img [ref=e37]
        - slider [ref=e41] [cursor=pointer]: "0.85"
    - generic [ref=e42]:
      - generic [ref=e44]:
        - generic [ref=e45]:
          - generic [ref=e46]: 0 sounds
          - button "New folder" [ref=e47] [cursor=pointer]:
            - img [ref=e48]
          - button "+ Add" [ref=e50] [cursor=pointer]
        - searchbox "Search sounds…" [ref=e52]
        - paragraph [ref=e55]:
          - text: No sounds yet.
          - text: Record or import a sample to build your library.
        - generic [ref=e56]: Drag sounds to tracks · drag to folder header to move
      - generic [ref=e57]:
        - generic [ref=e58]:
          - button "Session" [ref=e59] [cursor=pointer]
          - button "Arrangement" [ref=e60] [cursor=pointer]
          - button "Mixer" [ref=e61] [cursor=pointer]
        - generic [ref=e63]:
          - generic [ref=e64]:
            - button "Zoom in" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
            - button "Zoom out" [ref=e69] [cursor=pointer]:
              - img [ref=e70]
            - button "Fit to window" [ref=e73] [cursor=pointer]:
              - img [ref=e74]
            - generic [ref=e80]: SNAP
            - button "Off" [ref=e81] [cursor=pointer]
            - button "1/16" [ref=e82] [cursor=pointer]
            - button "1/8" [ref=e83] [cursor=pointer]
            - button "Beat" [ref=e84] [cursor=pointer]
            - button "Bar" [ref=e85] [cursor=pointer]
            - generic "Hold ⌥ Option while dragging to bypass snap" [ref=e86]: ⌥=free
          - generic [ref=e92]:
            - generic [ref=e94]:
              - generic [ref=e95] [cursor=pointer]:
                - generic [ref=e96]: Audio 1
                - generic [ref=e97]:
                  - button "M" [ref=e98]
                  - button "S" [ref=e99]
                  - slider [ref=e100]: "0.8"
                  - button "A" [ref=e101]:
                    - img [ref=e102]
                    - text: A
                  - button "⚙" [ref=e103]
              - generic [ref=e106]:
                - generic: 10 Andromeda (feat. D.R.A.M.)
            - generic [ref=e110]:
              - button "+A" [ref=e111] [cursor=pointer]
              - button "+M" [ref=e112] [cursor=pointer]
              - button "+D" [ref=e113] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e119] [cursor=pointer]:
    - img [ref=e120]
  - alert [ref=e123]
```

# Test source

```ts
  1   | /**
  2   |  * Exploratory test: loads a real .aif file, puts it on a track, moves it,
  3   |  * resizes it, explores MIDI instruments. Captures screenshots at every step.
  4   |  */
  5   | 
  6   | import { test, expect, type Page } from '@playwright/test'
  7   | 
  8   | const AIF_PATH = '/Users/brae/Desktop/Music/Song Examples/Gorillaz Synths Projects - Reverb Exclusive/Gorillaz Synths Projects - Reverb Exclusive/Andromeda Project/Samples/Processed/Consolidate/10 Andromeda (feat. D.R.A.M.).aif'
  9   | 
  10  | const allErrors: string[] = []
  11  | 
  12  | async function openEditor(page: Page) {
  13  |   page.on('console', msg => {
  14  |     if (msg.type() === 'error' || msg.type() === 'warning') {
  15  |       const t = msg.text()
  16  |       // Skip React DevTools noise
  17  |       if (!t.includes('Download the React') && !t.includes('[Fast Refresh]') && !t.includes('favicon')) {
  18  |         allErrors.push(`[${msg.type()}] ${t}`)
  19  |       }
  20  |     }
  21  |   })
  22  |   page.on('pageerror', err => allErrors.push(`[pageerror] ${err.message}`))
  23  |   await page.goto('/new?modules=audio')
  24  |   await expect(page.locator('[data-editor="true"]')).toBeVisible({ timeout: 15_000 })
  25  | }
  26  | 
  27  | async function shot(page: Page, name: string) {
  28  |   await page.screenshot({ path: `tests/e2e/screenshots/explore-${name}.png` })
  29  |   console.log(`  📸 ${name}`)
  30  | }
  31  | 
  32  | // ─────────────────────────────────────────────────────────────────────────────
  33  | 
  34  | test('explore: aif on track → move → resize → MIDI instruments', async ({ page }) => {
  35  |   await openEditor(page)
  36  |   await shot(page, '00-initial')
  37  | 
  38  |   // ── 1. Add an audio track ─────────────────────────────────────────────────
  39  |   await page.getByRole('button', { name: '+A' }).first().click()
  40  |   await page.waitForTimeout(400)
  41  |   await shot(page, '01-audio-track-added')
  42  | 
  43  |   // ── 2. Double-click the audio track lane to open file picker ──────────────
  44  |   const audioLane = page.locator('[data-testid="track-lane"][data-track-type="audio"]').first()
  45  |   await expect(audioLane).toBeVisible()
  46  | 
  47  |   const filechooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 })
  48  |   // Click in the left portion of the lane (beat 2-ish) at mid-height
  49  |   const laneBox = await audioLane.boundingBox()
  50  |   if (!laneBox) throw new Error('audio lane not found')
  51  |   await page.mouse.dblclick(laneBox.x + 80, laneBox.y + laneBox.height / 2)
  52  | 
  53  |   const fc = await filechooserPromise
  54  |   await fc.setFiles(AIF_PATH)
  55  |   console.log('  ✓ File chosen:', AIF_PATH.split('/').pop())
  56  | 
  57  |   // Wait for decode + waveform render
> 58  |   await page.waitForTimeout(4000)
      |              ^ Error: page.waitForTimeout: Test ended.
  59  |   await shot(page, '02-clip-loaded')
  60  | 
  61  |   // ── 3. Play briefly ──────────────────────────────────────────────────────
  62  |   await page.keyboard.press('Space')
  63  |   await page.waitForTimeout(1200)
  64  |   await shot(page, '03-playing')
  65  |   await page.keyboard.press('Space')
  66  |   await page.waitForTimeout(300)
  67  | 
  68  |   // ── 4. Move the clip (drag from body) ────────────────────────────────────
  69  |   // Clip starts at beat 0 in the lane, default beatW ≈ 50px
  70  |   // Drag from x+20 (inside clip) to x+200 (4 beats right)
  71  |   const laneBox2 = await audioLane.boundingBox()
  72  |   if (!laneBox2) throw new Error('lane gone after play')
  73  |   const clipBodyX = laneBox2.x + 20
  74  |   const clipBodyY = laneBox2.y + laneBox2.height / 2
  75  | 
  76  |   await page.mouse.move(clipBodyX, clipBodyY)
  77  |   await page.waitForTimeout(100)
  78  |   await page.mouse.down()
  79  |   await page.mouse.move(clipBodyX + 200, clipBodyY, { steps: 30 })
  80  |   await page.mouse.up()
  81  |   await page.waitForTimeout(400)
  82  |   await shot(page, '04-clip-moved')
  83  | 
  84  |   // ── 5. Resize clip smaller (drag right edge left) ─────────────────────────
  85  |   // After moving ~200px right, clip starts at ~200px from lane left.
  86  |   // Default clip duration = 8 beats × 50px = ~400px. Right edge at ~600px from lane left.
  87  |   // We look for the cursor change — just try near the expected right edge.
  88  |   const laneBox3 = await audioLane.boundingBox()
  89  |   if (!laneBox3) throw new Error('lane gone after move')
  90  | 
  91  |   // Approach: use mouse.move to scan for the resize cursor near the right edge of the clip.
  92  |   // Clip right edge estimate: laneBox.x + 200 (start after drag) + 400 (default 8-beat clip)
  93  |   const clipRightEstX = laneBox3.x + 200 + 400
  94  |   const clipMidY      = laneBox3.y + laneBox3.height / 2
  95  | 
  96  |   await page.mouse.move(clipRightEstX - 4, clipMidY)
  97  |   await page.waitForTimeout(200)
  98  |   await shot(page, '05-near-resize-handle')
  99  | 
  100 |   await page.mouse.down()
  101 |   await page.mouse.move(clipRightEstX - 4 - 150, clipMidY, { steps: 30 })
  102 |   await page.mouse.up()
  103 |   await page.waitForTimeout(400)
  104 |   await shot(page, '06-clip-shrunk')
  105 | 
  106 |   // ── 6. Expand clip (drag right edge right) ────────────────────────────────
  107 |   const clipNewRightX = clipRightEstX - 150
  108 |   await page.mouse.move(clipNewRightX - 4, clipMidY)
  109 |   await page.waitForTimeout(200)
  110 |   await page.mouse.down()
  111 |   await page.mouse.move(clipNewRightX + 200, clipMidY, { steps: 30 })
  112 |   await page.mouse.up()
  113 |   await page.waitForTimeout(400)
  114 |   await shot(page, '07-clip-expanded')
  115 | 
  116 |   // ── 7. Stretch track height taller ───────────────────────────────────────
  117 |   // The height resize handle is 4px at the very bottom of the track row.
  118 |   const laneBox4 = await audioLane.boundingBox()
  119 |   if (!laneBox4) throw new Error('lane gone')
  120 |   const resizeY = laneBox4.y + laneBox4.height - 2
  121 |   const resizeX = laneBox4.x + 80
  122 | 
  123 |   await page.mouse.move(resizeX, resizeY)
  124 |   await page.waitForTimeout(100)
  125 |   await page.mouse.down()
  126 |   await page.mouse.move(resizeX, resizeY + 80, { steps: 20 })
  127 |   await page.mouse.up()
  128 |   await page.waitForTimeout(400)
  129 |   await shot(page, '08-track-taller')
  130 | 
  131 |   // Shrink it back
  132 |   const laneBox5 = await audioLane.boundingBox()
  133 |   if (laneBox5) {
  134 |     const resizeY2 = laneBox5.y + laneBox5.height - 2
  135 |     await page.mouse.move(resizeX, resizeY2)
  136 |     await page.mouse.down()
  137 |     await page.mouse.move(resizeX, resizeY2 - 60, { steps: 20 })
  138 |     await page.mouse.up()
  139 |     await page.waitForTimeout(400)
  140 |     await shot(page, '09-track-shorter')
  141 |   }
  142 | 
  143 |   // ── 8. Zoom in and out ────────────────────────────────────────────────────
  144 |   await page.getByTitle('Zoom in').click()
  145 |   await page.getByTitle('Zoom in').click()
  146 |   await page.getByTitle('Zoom in').click()
  147 |   await shot(page, '10-zoomed-in')
  148 |   await page.getByTitle('Zoom out').click()
  149 |   await page.getByTitle('Zoom out').click()
  150 |   await page.getByTitle('Zoom out').click()
  151 |   await shot(page, '11-zoomed-out')
  152 | 
  153 |   // ── 9. Add a MIDI track and create a clip ─────────────────────────────────
  154 |   await page.getByRole('button', { name: '+M' }).first().click()
  155 |   await page.waitForTimeout(300)
  156 |   await shot(page, '12-midi-track-added')
  157 | 
  158 |   const midiLane = page.locator('[data-testid="track-lane"][data-track-type="midi"]').first()
```