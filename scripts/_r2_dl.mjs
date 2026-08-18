import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const DIR='/Users/brae/.claude/jobs/22b592f1/tmp/rad2'
const S=JSON.parse(readFileSync(`${DIR}/src.json`,'utf8'))
const jobs=[]
for(const k of Object.keys(S)) S[k].tracks.forEach((t,i)=>{ t.file=`${DIR}/${k}_${String(i).padStart(2,'0')}.mp3`; jobs.push(t) })
writeFileSync(`${DIR}/src.json`,JSON.stringify(S))
let done=0,skip=0,fail=0
async function run(t){ if(existsSync(t.file)&&statSync(t.file).size>50000){skip++;return} for(let a=0;a<3;a++){try{execFileSync('curl',['-sL','--fail','-m','120','-o',t.file,t.url.replace('format=flac','format=mp32'),'-H','user-agent: Mozilla/5.0']);if(statSync(t.file).size>50000){done++;return}}catch{}} t.file=null;fail++ }
const q=[...jobs]; await Promise.all(Array.from({length:8},async()=>{while(q.length)await run(q.shift())}))
writeFileSync(`${DIR}/src.json`,JSON.stringify(S))
console.log('done',done,'skip',skip,'fail',fail,'of',jobs.length)
