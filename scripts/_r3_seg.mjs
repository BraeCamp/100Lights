import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const DIR='/Users/brae/.claude/jobs/22b592f1/tmp/rad2'
const clips=JSON.parse(readFileSync(`${DIR}/clips2.json`,'utf8'))
const SEG=14
const GRADE={
 sleep:'eq=brightness=-0.06:saturation=0.82,colorbalance=bs=0.07:bm=0.03',
 study:'eq=brightness=-0.02:saturation=0.95,colorbalance=rs=0.03:bs=-0.02',
 jazzcafe:'eq=saturation=1.1:brightness=-0.01,colorbalance=rs=0.07:rm=0.04:bs=-0.05',
}
let done=0,fail=0
for(const cat of Object.keys(clips)){
  const segs=[]
  const q=[...clips[cat].entries()]
  // limited concurrency for downloads, then encode
  for(const [i,c] of q){
    const raw=`${DIR}/r3raw_${cat}_${i}.mp4`, seg=`${DIR}/r3seg_${cat}_${String(i).padStart(2,'0')}.mp4`
    if(existsSync(seg)&&statSync(seg).size>10000){segs.push(seg);done++;continue}
    try{ execFileSync('curl',['-sL','--fail','-m','120','-o',raw,c.link]) }catch{ fail++; continue }
    const vf=`scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${GRADE[cat]},fps=30,setsar=1`
    try{ execFileSync('ffmpeg',['-y','-stream_loop','-1','-i',raw,'-t',String(SEG),'-an','-vf',vf,'-c:v','libx264','-preset','veryfast','-b:v','1700k','-pix_fmt','yuv420p',seg],{stdio:['ignore','ignore','ignore']}); segs.push(seg); done++ }catch{ fail++ }
    try{ execFileSync('rm',['-f',raw]) }catch{}
  }
  writeFileSync(`${DIR}/segs_${cat}.json`,JSON.stringify(segs))
  console.log(`${cat}: ${segs.length} segments`)
}
console.log('done',done,'fail',fail)
