// Get a YouTube upload refresh-token for ONE specific channel in your Google account.
// Run it once per channel — the Google consent screen lets you pick which channel to authorize.
//
//   node scripts/yt-channel-token.mjs radio      # label for the channel (e.g. "radio", "main")
//
// You (in your browser, already signed into Google) click the printed URL, choose the target
// channel, and approve. This script catches the redirect on localhost and prints the refresh token
// to paste into .env.local as YT_REFRESH_TOKEN_<LABEL>.  Claude never sees your password.
//
// One-time setup: the OAuth client (YT_CLIENT_ID) must allow the redirect below.
//  - If it's a "Desktop app" OAuth client, http://localhost:8765/callback works automatically.
//  - If it's a "Web application" client, add  http://localhost:8765/callback  as an authorized
//    redirect URI in Google Cloud Console → Credentials (your step; ~30s).
import { readFileSync } from 'node:fs'
import http from 'node:http'
const env = {}
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const CID = env.YT_CLIENT_ID, SECRET = env.YT_CLIENT_SECRET
if (!CID || !SECRET) { console.error('Missing YT_CLIENT_ID / YT_CLIENT_SECRET in .env.local'); process.exit(1) }
const label = (process.argv[2] || 'channel').replace(/[^a-z0-9]/gi, '').toUpperCase()
const PORT = 8765, REDIRECT = `http://localhost:${PORT}/callback`
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
})
console.log(`\n1) Open this URL in your browser, pick the "${process.argv[2] || 'target'}" channel, and approve:\n\n${authUrl}\n`)
console.log('2) Waiting for the redirect on localhost…\n')
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) { res.writeHead(404); res.end(); return }
  const code = new URL(req.url, REDIRECT).searchParams.get('code')
  if (!code) { res.writeHead(400); res.end('No code'); return }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) })
    const j = await r.json()
    if (!j.refresh_token) throw new Error('No refresh_token returned: ' + JSON.stringify(j))
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h2>✅ Done — refresh token captured. You can close this tab.</h2>')
    console.log('✅ SUCCESS — add this line to .env.local:\n')
    console.log(`YT_REFRESH_TOKEN_${label}=${j.refresh_token}\n`)
    console.log('Tell Claude the label and it will upload that channel\'s videos there.')
  } catch (e) {
    res.writeHead(500); res.end('Error: ' + e.message); console.error('❌', e.message)
  } finally { setTimeout(() => server.close(), 500) }
})
server.listen(PORT)
