# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: daw.spec.ts >> DAW shell >> view tabs render and switch
- Location: tests/e2e/daw.spec.ts:44:7

# Error details

```
Error: Channel closed
```

```
Error: page.screenshot: Test ended.
Call log:
  - taking page screenshot
  - waiting for fonts to load...
  - fonts loaded

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
      - generic [ref=e58]:
        - button "Session" [ref=e59] [cursor=pointer]
        - button "Arrangement" [ref=e60] [cursor=pointer]
        - button "Mixer" [ref=e61] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e68] [cursor=pointer]:
    - img [ref=e69]
  - alert [ref=e72]
```

# Test source

```ts
  1   | /**
  2   |  * DAW end-to-end tests.
  3   |  * Runs against a local Next.js dev server with DEV_OPEN=1 (auth bypassed).
  4   |  *
  5   |  * Each test navigates to /new?modules=audio, which renders the full DAW
  6   |  * editor (AudioEditor → Transport, SessionView, ArrangementView, Mixer, etc.)
  7   |  * without needing a saved project or real user account.
  8   |  */
  9   | 
  10  | import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
  11  | 
  12  | // ── Helpers ──────────────────────────────────────────────────────────────────
  13  | 
  14  | async function openEditor(page: Page) {
  15  |   // Collect JS console errors throughout the test
  16  |   const errors: string[] = []
  17  |   page.on('console', (msg: ConsoleMessage) => {
  18  |     if (msg.type() === 'error') errors.push(msg.text())
  19  |   })
  20  |   page.on('pageerror', (err: Error) => errors.push(`Uncaught: ${err.message}`))
  21  | 
  22  |   await page.goto('/new?modules=audio')
  23  | 
  24  |   // Wait until the Transport bar is visible — means DAW fully mounted
  25  |   await expect(page.locator('[data-editor="true"]')).toBeVisible({ timeout: 15_000 })
  26  | 
  27  |   return errors
  28  | }
  29  | 
  30  | async function clickTransportButton(page: Page, label: string) {
  31  |   await page.getByRole('button', { name: label }).first().click()
  32  | }
  33  | 
  34  | // ── Tests ─────────────────────────────────────────────────────────────────────
  35  | 
  36  | test.describe('DAW shell', () => {
  37  |   test('editor mounts without JS errors', async ({ page }) => {
  38  |     const errors = await openEditor(page)
  39  |     // Screenshot for visual inspection
  40  |     await page.screenshot({ path: 'tests/e2e/screenshots/01-initial-load.png', fullPage: false })
  41  |     expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  42  |   })
  43  | 
  44  |   test('view tabs render and switch', async ({ page }) => {
  45  |     await openEditor(page)
  46  | 
  47  |     for (const view of ['Session', 'Arrangement', 'Mixer']) {
  48  |       await page.getByRole('button', { name: view }).click()
  49  |       if (view === 'Mixer') {
  50  |         await page.waitForSelector('[data-testid="mixer"]', { timeout: 8000 })
  51  |       }
> 52  |       await page.screenshot({ path: `tests/e2e/screenshots/02-view-${view.toLowerCase()}.png` })
      |                  ^ Error: page.screenshot: Test ended.
  53  |       await expect(page.locator('[data-editor="true"]')).toBeVisible()
  54  |     }
  55  |   })
  56  | })
  57  | 
  58  | test.describe('Transport', () => {
  59  |   test('BPM input is editable', async ({ page }) => {
  60  |     await openEditor(page)
  61  |     // BPM is shown as a button — click it to reveal the number input
  62  |     await page.getByTitle('Click to edit BPM').click()
  63  |     const bpmInput = page.locator('input[type="number"]').first()
  64  |     await bpmInput.fill('140')
  65  |     await bpmInput.press('Enter')
  66  |     // After commit the button reappears showing the new tempo
  67  |     await expect(page.getByTitle('Click to edit BPM')).toContainText('140')
  68  |   })
  69  | 
  70  |   test('Play/Stop button cycles state', async ({ page }) => {
  71  |     const errors = await openEditor(page)
  72  |     // Space bar should toggle play/stop without errors
  73  |     await page.keyboard.press('Space')
  74  |     await page.waitForTimeout(300)
  75  |     await page.keyboard.press('Space')
  76  |     expect(errors).toHaveLength(0)
  77  |   })
  78  | 
  79  |   test('Metronome toggle does not throw', async ({ page }) => {
  80  |     const errors = await openEditor(page)
  81  |     await page.keyboard.press('m')
  82  |     await page.waitForTimeout(200)
  83  |     await page.keyboard.press('m')
  84  |     expect(errors).toHaveLength(0)
  85  |   })
  86  | })
  87  | 
  88  | test.describe('Session View', () => {
  89  |   test('renders track list and scene buttons', async ({ page }) => {
  90  |     await openEditor(page)
  91  |     await page.getByRole('button', { name: 'Session' }).click()
  92  |     await page.screenshot({ path: 'tests/e2e/screenshots/03-session-view.png' })
  93  |     // Add Audio track button
  94  |     await page.getByRole('button', { name: '+A' }).first().click()
  95  |     await page.screenshot({ path: 'tests/e2e/screenshots/04-session-track-added.png' })
  96  |     // Should not crash after adding a track
  97  |     await expect(page.locator('[data-editor="true"]')).toBeVisible()
  98  |   })
  99  | 
  100 |   test('quantization selector exists', async ({ page }) => {
  101 |     await openEditor(page)
  102 |     await page.getByRole('button', { name: 'Session' }).click()
  103 |     // The Q: selector is a <select> in the track headers column
  104 |     const qSelect = page.locator('select').first()
  105 |     await expect(qSelect).toBeVisible()
  106 |   })
  107 | })
  108 | 
  109 | test.describe('Arrangement View', () => {
  110 |   test('renders ruler and track header area', async ({ page }) => {
  111 |     await openEditor(page)
  112 |     // Arrangement is the default view
  113 |     await page.screenshot({ path: 'tests/e2e/screenshots/05-arrangement-initial.png' })
  114 |     await expect(page.locator('[data-editor="true"]')).toBeVisible()
  115 |   })
  116 | 
  117 |   test('adding tracks creates rows', async ({ page }) => {
  118 |     await openEditor(page)
  119 |     // Add an audio track
  120 |     await page.getByRole('button', { name: '+A' }).first().click()
  121 |     // Add a MIDI track
  122 |     await page.getByRole('button', { name: '+M' }).first().click()
  123 |     // Add a drum track
  124 |     await page.getByRole('button', { name: '+D' }).first().click()
  125 |     await page.screenshot({ path: 'tests/e2e/screenshots/06-arrangement-tracks-added.png' })
  126 |     await expect(page.locator('[data-editor="true"]')).toBeVisible()
  127 |   })
  128 | 
  129 |   test('zoom in/out toolbar works', async ({ page }) => {
  130 |     await openEditor(page)
  131 |     await page.getByTitle('Zoom in').click()
  132 |     await page.getByTitle('Zoom in').click()
  133 |     await page.getByTitle('Zoom out').click()
  134 |     await page.screenshot({ path: 'tests/e2e/screenshots/07-arrangement-zoomed.png' })
  135 |     await expect(page.locator('[data-editor="true"]')).toBeVisible()
  136 |   })
  137 | 
  138 |   test('snap mode buttons work', async ({ page }) => {
  139 |     await openEditor(page)
  140 |     for (const snap of ['Off', '1/16', '1/8', 'Beat', 'Bar']) {
  141 |       await page.getByRole('button', { name: snap }).first().click()
  142 |     }
  143 |     await expect(page.locator('[data-editor="true"]')).toBeVisible()
  144 |   })
  145 | })
  146 | 
  147 | test.describe('Mixer View', () => {
  148 |   test('renders channel strips', async ({ page }) => {
  149 |     await openEditor(page)
  150 |     // Add some tracks first so there are channels to show
  151 |     await page.getByRole('button', { name: '+A' }).first().click()
  152 |     await page.getByRole('button', { name: '+M' }).first().click()
```