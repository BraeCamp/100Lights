import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']})
const page=await (await browser.newContext({viewport:{width:1600,height:900}})).newPage()
await page.addInitScript(()=>{try{localStorage.setItem('100lights-ui-tier','full')}catch{}})
await page.goto('http://localhost:3000/new?modules=audio&audioMode=music',{waitUntil:'domcontentloaded',timeout:60000})
await page.waitForFunction(()=>typeof window.__dawRenderOffline==='function',null,{timeout:30000})
await page.waitForTimeout(2500)
await page.evaluate(async()=>{const D=window.__dawDispatch,uid=()=>crypto.randomUUID(),w=ms=>new Promise(r=>setTimeout(r,ms))
  const mk=async(name,notes)=>{const t=uid(),c=uid();D({type:'ADD_TRACK',id:t,name,instrument:{type:'poly',params:{}}});await w(150);D({type:'ADD_CLIP',clip:{id:c,trackId:t,kind:'midi',name,startBeat:0,durationBeats:8,loopEnabled:true,loopLengthBeats:8,notes:[],color:'#8b7cf0',presetId:'builtin-0'}});await w(150);for(const n of notes)D({type:'ADD_MIDI_NOTE',clipId:c,note:{startBeat:n[0],durationBeats:n[1],pitch:n[2],velocity:0.9}});D({type:'UPDATE_CLIP',clipId:c,patch:{durationBeats:16}})}
  await mk('Keys',[[0,4,60],[0,4,63],[0,4,67],[4,4,56],[4,4,60],[4,4,63]]);await mk('Bass',[[0,4,36],[4,4,44]])})
await page.waitForTimeout(500)
console.log('rendering offline…')
const r=await page.evaluate(async()=>await window.__dawRenderOffline())
console.log('returned:',{type:r.type,durationSec:r.durationSec,bytes:r.bytes})
if(r?.base64){writeFileSync('/Users/brae/.claude/jobs/22b592f1/tmp/offline.audio',Buffer.from(r.base64,'base64'))}
await browser.close()
