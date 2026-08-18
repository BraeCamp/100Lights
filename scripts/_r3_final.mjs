import { execFileSync } from 'node:child_process'
const DIR='/Users/brae/.claude/jobs/22b592f1/tmp/rad2'
for(const cat of ['sleep','study','jazzcafe']){
  const montage=`${DIR}/montage2_${cat}.mp4`, mix=`${DIR}/mix_${cat}.m4a`, ass=`${DIR}/np_${cat}.ass`, out=`${DIR}/FINAL_${cat}.mp4`
  console.log(`▸ ${cat}: looping + burning overlays + muxing…`)
  execFileSync('ffmpeg',['-y','-stream_loop','-1','-i',montage,'-i',mix,
    '-vf',`subtitles=${ass}`,
    '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-b:v','2200k','-maxrate','2600k','-bufsize','4400k','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',out],{stdio:['ignore','ignore','ignore']})
  const dur=execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',out]).toString().trim()
  console.log(`  ✓ ${(Number(dur)/60).toFixed(1)}min`)
}
