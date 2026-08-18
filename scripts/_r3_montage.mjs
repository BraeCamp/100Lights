import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const DIR='/Users/brae/.claude/jobs/22b592f1/tmp/rad2'
const SEG=14, XF=1
for(const cat of ['sleep','study','jazzcafe']){
  const segs=JSON.parse(readFileSync(`${DIR}/segs_${cat}.json`,'utf8'))
  const inputs=[]; segs.forEach(s=>inputs.push('-i',s))
  const fc=[]; let prev='0:v'
  for(let i=1;i<segs.length;i++){ const out=(i===segs.length-1)?'v':`x${i}`; const off=i*(SEG-XF); fc.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${off}[${out}]`); prev=out }
  const montage=`${DIR}/montage2_${cat}.mp4`
  execFileSync('ffmpeg',['-y',...inputs,'-filter_complex',fc.join(';'),'-map','[v]','-c:v','libx264','-preset','veryfast','-b:v','2000k','-pix_fmt','yuv420p','-movflags','+faststart',montage],{stdio:['ignore','ignore','ignore']})
  const dur=execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',montage]).toString().trim()
  console.log(`${cat}: ${segs.length}-clip montage, ${(Number(dur)/60).toFixed(1)}min`)
}
