#!/usr/bin/env python3
# Generates two build-specs (song1/song2.json) for 100Lights.
# Philosophy this pass: BREATHING RHYTHM. Instruments don't all play straight to
# the beat — each part gets a 16th-grid pattern with deliberate rests (x) and
# notes (o) so tension builds and releases (e.g. "oxoxoxooxoxooooo"). The lead
# occasionally plays double-stops/chords: on bar downbeats for emphasis and a
# stray double note mid-phrase for style — never constantly.
import json, os

STEP = 0.25          # 16th note in beats
PUB = "/Users/brae/100lights/public/_songgen"

NOTE = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,
        'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11}
def m(n):
    i=0
    for j,ch in enumerate(n):
        if ch.isdigit() or (ch=='-' and j>0): i=j; break
    name=n[:i]; octv=int(n[i:])
    return NOTE[name]+(octv+1)*12

def hvel(base, pos):
    d=((pos*7)%5)-2
    if pos%16==0: base+=6
    elif pos%8==0: base+=3
    elif pos%2==1: base-=4
    return int(max(28,min(120,base+d)))

class Song:
    def __init__(s,**meta): s.meta=meta; s.tracks=[]; s.clips=[]
    def track(s,tid,name,instr,volume=0.8,pan=0.0):
        s.tracks.append(dict(id=tid,name=name,instrument=instr,volume=volume,pan=pan)); return tid
    def clip(s,cid,tid,presetId,rollFx,start,dur):
        c=dict(id=cid,trackId=tid,presetId=presetId,rollFx=rollFx,
               startBeat=start,durationBeats=dur,notes=[]); s.clips.append(c); return c
    def dump(s,path):
        json.dump(dict(**s.meta,tracks=s.tracks,clips=s.clips),open(path,'w'))
        n=sum(len(c['notes']) for c in s.clips)
        end=max((nn['startBeat']+nn['durationBeats']) for c in s.clips for nn in c['notes'])
        print(f"{os.path.basename(path)}: {len(s.tracks)} trk, {len(s.clips)} clip, {n} notes, "
              f"{end:.0f} beats = {end/s.meta['tempo']*60:.0f}s")

def add(clip,pos,dur,pitch,vel):
    clip['notes'].append(dict(pitch=int(pitch),startBeat=round(pos,4),
                              durationBeats=round(dur,4),velocity=int(vel)))

def comp(clip,bar0,chords,pat,base=70,ring=None,stac=False):
    for b,ch in enumerate(chords):
        onsets=[i for i,c in enumerate(pat) if c=='o']
        for k,i in enumerate(onsets):
            nxt=onsets[k+1] if k+1<len(onsets) else 16
            length=(nxt-i) if ring is None else ring
            if stac: length=min(length,1.6)
            pos=(bar0+b)*4+i*STEP
            for p in ch:
                add(clip,pos,length*STEP*(0.9 if stac else 1.0),p,hvel(base,i))

def bassline(clip,bar0,roots,pat,base=74,moves=None):
    moves=moves or {}
    for b,root in enumerate(roots):
        onsets=[i for i,c in enumerate(pat) if c=='o']
        for k,i in enumerate(onsets):
            nxt=onsets[k+1] if k+1<len(onsets) else 16
            add(clip,(bar0+b)*4+i*STEP,(nxt-i)*STEP*0.95,root+moves.get(i,0),hvel(base,i))

def drums(clip,bar0,bars,kick,snare,hat,ohat="",clap="",crash=""):
    lanes=[(36,kick,0.5,96),(38,snare,0.4,86),(42,hat,0.18,52),
           (46,ohat,0.3,58),(39,clap,0.35,80),(49,crash,1.2,90)]
    for b in range(bars):
        for pitch,pat,dur,vel in lanes:
            for i,ch in enumerate(pat):
                if ch=='o':
                    v=vel+(8 if(pitch==42 and i%4==0)else 0)-(10 if pitch==42 and i%2==1 else 0)
                    add(clip,(bar0+b)*4+i*STEP,dur,pitch,hvel(v,i))

def lead(clip,bar0,entries):
    for pos,ln,pit,vel,harm in entries:
        b=bar0*4+pos*STEP
        add(clip,b,ln*STEP,m(pit),vel)
        if harm: add(clip,b,ln*STEP,m(harm),max(30,vel-14))

# ── SONG 1 — Signal Fire · Am · 92bpm ─────────────────────────────────────────
def song1():
    S=Song(id="sig-fire-2026a",name="Signal Fire (moody-alt, ~2:00)",
           tempo=92,timeSignatureNum=4,timeSignatureDen=4,swing=0.06,
           key=9,scale='minor',masterVolume=0.9)
    gtr=S.track('gtr','Clean Guitar',{'type':'none','params':{}},0.72,-0.18)
    bs=S.track('bass','Bass',{'type':'none','params':{}},0.8,0.0)
    dr=S.track('drums','Drums',{'type':'drum','params':{'pack':'synth'}},0.82,0.0)
    pad=S.track('pad','Strings',{'type':'none','params':{}},0.5,0.14)
    pno=S.track('pno','Piano',{'type':'none','params':{}},0.62,-0.1)
    ld=S.track('lead','Violin Lead',{'type':'none','params':{}},0.9,0.06)
    AmC=[m('A3'),m('C4'),m('E4')]; FC=[m('F3'),m('A3'),m('C4')]
    CC=[m('G3'),m('C4'),m('E4')]; EC=[m('G#3'),m('B3'),m('E4')]
    comp_ch=[AmC,FC,CC,EC]
    padAm=[m('A3'),m('E4'),m('A4')]; padF=[m('A3'),m('C4'),m('F4')]
    padC=[m('G3'),m('C4'),m('G4')]; padE=[m('G#3'),m('B3'),m('E4')]
    pad_ch=[padAm,padF,padC,padE]
    roots=[m('A2'),m('F2'),m('C2'),m('E2')]
    G_STAB="oxxoxxoxxoxooxxo"; G_DRIV="oxoxoxooxoxooooo"
    B_SYNC="oxxoxxxooxxoxxxo"; B_DRIV="oxoxxoxooxoxxoxo"
    K1="oxxxxxxxooxxxxxx"; S1="xxxxoxxxxxxxoxxx"; H1="xxoxxxoxxxoxxxox"
    K2="oxxxooxxoxxxxoxx"; S2="xxxxoxxxxxxxoxxo"; H2="oxoxoxoxoxoxoxox"
    OH="xxxxxxxoxxxxxxxx"
    C=dict(
      gtr=S.clip('gtr-c',gtr,'builtin-35',{'reverbWet':0.18,'sustain':0.25,'gain':1.15,'highpassHz':110},0,999),
      bs =S.clip('bs-c',bs,'builtin-19',{'reverbWet':0.08,'filterHz':3200,'gain':1.55},0,999),
      dr =S.clip('dr-c',dr,None,None,0,999),
      pad=S.clip('pad-c',pad,'builtin-28',{'reverbWet':0.5,'reverbSize':0.8,'attack':0.5,'gain':1.5,'filterHz':5200},0,999),
      pno=S.clip('pno-c',pno,'builtin-26',{'reverbWet':0.3,'reverbSize':0.7,'sustain':0.8,'gain':1.6},0,999),
      ld =S.clip('ld-c',ld,'builtin-40',{'reverbWet':0.34,'reverbSize':0.7,'sustain':0.4,'gain':1.7,'vibratoDepth':0.12},0,999),
    )
    bar=0
    comp(C['gtr'],bar,comp_ch,G_STAB,base=58,stac=True)
    bassline(C['bs'],bar,roots,B_SYNC,base=66,moves={9:12})
    comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=44,ring=16)
    bar+=4
    for r in range(2):
        comp(C['gtr'],bar,comp_ch,G_STAB,base=66,stac=True)
        bassline(C['bs'],bar,roots,B_SYNC,base=74,moves={9:12,14:7})
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=46,ring=16)
        drums(C['dr'],bar,4,K1,S1,H1); bar+=4
    lead(C['ld'],bar-4,[
        (4,3,'E5',74,None),(8,4,'C5',70,None),(14,2,'D5',66,None),
        (20,3,'C5',72,None),(24,6,'B4',74,None),
        (36,2,'G#4',70,None),(40,4,'B4',78,'E4'),(46,2,'A4',70,None)])
    hook=[
        (2,2,'A4',86,'C5'),(6,2,'C5',78,None),(8,4,'E5',88,None),
        (18,2,'F5',82,'A4'),(22,2,'E5',74,None),(26,4,'C5',80,None),
        (34,2,'G5',84,'E5'),(38,3,'E5',78,None),(43,3,'D5',74,None),
        (50,2,'G#5',82,'B4'),(54,2,'B5',80,None),(56,1,'A5',70,None),(57,1,'G5',68,None),
        (58,1,'F5',70,None),(59,1,'E5',72,None),(60,4,'E5',84,None)]
    for r in range(2):
        comp(C['gtr'],bar,comp_ch,G_DRIV,base=72,stac=True)
        bassline(C['bs'],bar,roots,B_DRIV,base=80,moves={9:12,12:12,14:7})
        comp(C['pno'],bar,comp_ch,"oxxxoxxxoxxxoxxx",base=60)
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=50,ring=16)
        drums(C['dr'],bar,4,K2,S2,H2,ohat=OH,crash=("oxxxxxxxxxxxxxxx" if r==0 else "")); bar+=4
    lead(C['ld'],bar-8,hook)
    comp(C['pno'],bar,comp_ch,"oxxxxxxxoxxxxxxx",base=54,ring=8)
    bassline(C['bs'],bar,roots,"oxxxxxxxxxxxxxxx",base=64)
    lead(C['ld'],bar,[(8,6,'C5',66,None),(24,3,'B4',64,None),(40,8,'B4',72,'G#4')])
    bar+=4
    for r in range(2):
        comp(C['gtr'],bar,comp_ch,G_DRIV,base=74,stac=True)
        bassline(C['bs'],bar,roots,B_DRIV,base=82,moves={9:12,12:12,14:7})
        comp(C['pno'],bar,comp_ch,"oxxxoxxxoxxxoxxx",base=62)
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=52,ring=16)
        drums(C['dr'],bar,4,K2,S2,H2,ohat=OH,crash=("oxxxxxxxxxxxxxxx" if r==0 else "")); bar+=4
    lead(C['ld'],bar-8,hook)
    comp(C['pad'],bar,[padAm,padAm,padF,padF,padAm,padAm],"oxxxxxxxxxxxxxxx",base=46,ring=16)
    comp(C['pno'],bar,[AmC,AmC,FC,FC,AmC,AmC],"oxxxxxxxoxxxxxxx",base=52,ring=8)
    bassline(C['bs'],bar,[m('A2'),m('A2'),m('F2'),m('F2'),m('A2'),m('A2')],"oxxxxxxxxxxxxxxx",base=58)
    lead(C['ld'],bar,[(4,6,'E5',64,None),(16,10,'C5',60,None),(64,16,'A4',56,'E4')])
    bar+=6
    end=bar*4
    for c in S.clips: c['durationBeats']=end
    S.dump(f"{PUB}/song1.json")

# ── SONG 2 — Paper Lanterns · Bm · 76bpm swing ────────────────────────────────
def song2():
    S=Song(id="paper-lant-2026a",name="Paper Lanterns (neo-soul, ~2:00)",
           tempo=76,timeSignatureNum=4,timeSignatureDen=4,swing=0.14,
           key=11,scale='minor',masterVolume=0.9)
    rho=S.track('rho','Rhodes',{'type':'none','params':{}},0.66,-0.14)
    bs=S.track('bass','Bass',{'type':'none','params':{}},0.8,0.0)
    dr=S.track('drums','Drums',{'type':'drum','params':{'pack':'synth'}},0.7,0.0)
    vib=S.track('vib','Vibraphone',{'type':'none','params':{}},0.5,0.2)
    pad=S.track('pad','Choir Pad',{'type':'none','params':{}},0.42,0.16)
    ld=S.track('lead','Pan Flute',{'type':'none','params':{}},0.86,-0.05)
    Bm7=[m('B2'),m('D3'),m('F#3'),m('A3')]; Gma7=[m('B2'),m('D3'),m('F#3'),m('G3')]
    Dma=[m('A2'),m('D3'),m('F#3')]; A7=[m('A2'),m('C#3'),m('E3'),m('G3')]
    comp_ch=[Bm7,Gma7,Dma,A7]
    padBm=[m('F#3'),m('B3'),m('D4')]; padG=[m('G3'),m('B3'),m('D4')]
    padD=[m('F#3'),m('A3'),m('D4')]; padA=[m('E3'),m('A3'),m('C#4')]
    pad_ch=[padBm,padG,padD,padA]
    roots=[m('B1'),m('G1'),m('D2'),m('A1')]
    R_KEYS="oxxoxxoxoxxoxxxo"; R_SPARSE="oxxxxxxoxxxxoxxx"
    B_SOUL="oxxoxxxooxxxoxxo"
    K1="oxxxxxxxoxxxoxxx"; S1="xxxxoxxxxxxxoxxx"; H1="oxxoxxoxoxxoxxox"
    K2="oxxxooxxoxxxoxxo"; S2="xxxxoxxoxxxxoxxx"; H2="oxoxoxoxoxoxoxox"
    CLAP="xxxxoxxxxxxxoxxx"
    C=dict(
      rho=S.clip('rho-c',rho,'builtin-27',{'reverbWet':0.26,'reverbSize':0.6,'sustain':0.5,'gain':1.35,'chorusDepth':0.18},0,999),
      bs =S.clip('bs-c',bs,'builtin-19',{'reverbWet':0.06,'filterHz':2600,'gain':1.5},0,999),
      dr =S.clip('dr-c',dr,None,None,0,999),
      vib=S.clip('vib-c',vib,'builtin-36',{'reverbWet':0.4,'reverbSize':0.7,'sustain':0.5,'gain':1.5,'delayWet':0.14,'delayTime':0.34},0,999),
      pad=S.clip('pad-c',pad,'builtin-29',{'reverbWet':0.55,'reverbSize':0.85,'attack':0.6,'gain':1.7,'filterHz':4200},0,999),
      ld =S.clip('ld-c',ld,'builtin-43',{'reverbWet':0.38,'reverbSize':0.7,'sustain':0.35,'gain':1.75,'vibratoDepth':0.1},0,999),
    )
    bar=0
    comp(C['rho'],bar,comp_ch,R_SPARSE,base=54)
    comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=40,ring=16)
    bar+=4
    for r in range(2):
        comp(C['rho'],bar,comp_ch,R_KEYS,base=62)
        bassline(C['bs'],bar,roots,B_SOUL,base=74,moves={8:12})
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=42,ring=16)
        drums(C['dr'],bar,4,K1,S1,H1,clap=CLAP); bar+=4
    lead(C['vib'],bar-4,[(6,2,'F#5',60,None),(12,2,'D5',56,None),(22,2,'A5',58,None),
                         (38,2,'E5',56,None),(44,3,'F#5',60,None)])
    theme=[
        (4,3,'F#5',80,'D5'),(10,2,'D5',70,None),(12,4,'E5',76,None),
        (18,2,'D5',74,None),(22,2,'B4',68,None),(26,4,'D5',78,'G4'),
        (34,3,'F#5',82,None),(40,2,'A5',78,None),(44,3,'G5',72,None),
        (50,2,'E5',78,'C#5'),(54,1,'F#5',72,None),(55,1,'E5',70,None),
        (56,1,'D5',72,None),(58,1,'C#5',70,None),(60,4,'B4',80,None)]
    for r in range(2):
        comp(C['rho'],bar,comp_ch,R_KEYS,base=64)
        bassline(C['bs'],bar,roots,B_SOUL,base=76,moves={8:12,13:7})
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=46,ring=16)
        drums(C['dr'],bar,4,K2,S2,H2,clap=CLAP); bar+=4
    lead(C['ld'],bar-8,theme)
    comp(C['rho'],bar,[Bm7,Gma7,A7,A7],"oxxxxxxxoxxxxxxx",base=52,ring=8)
    comp(C['pad'],bar,[padBm,padG,padA,padA],"oxxxxxxxxxxxxxxx",base=44,ring=16)
    lead(C['ld'],bar,[(8,6,'D5',62,None),(40,10,'C#5',70,'E4')])
    bar+=4
    for r in range(2):
        comp(C['rho'],bar,comp_ch,R_KEYS,base=66)
        bassline(C['bs'],bar,roots,B_SOUL,base=78,moves={8:12,13:7})
        comp(C['vib'],bar,comp_ch,"oxxxoxxxoxxxoxxx",base=48)
        comp(C['pad'],bar,pad_ch,"oxxxxxxxxxxxxxxx",base=48,ring=16)
        drums(C['dr'],bar,4,K2,S2,H2,clap=CLAP); bar+=4
    lead(C['ld'],bar-8,theme)
    comp(C['pad'],bar,[padBm,padBm,padG,padG,padBm,padBm],"oxxxxxxxxxxxxxxx",base=42,ring=16)
    comp(C['rho'],bar,[Bm7,Bm7,Gma7,Gma7,Bm7,Bm7],"oxxxxxxxoxxxxxxx",base=50,ring=8)
    bassline(C['bs'],bar,[m('B1'),m('B1'),m('G1'),m('G1'),m('B1'),m('B1')],"oxxxxxxxxxxxxxxx",base=56)
    lead(C['ld'],bar,[(4,6,'F#5',60,None),(18,10,'D5',56,None),(64,16,'B4',54,'F#4')])
    bar+=6
    end=bar*4
    for c in S.clips: c['durationBeats']=end
    S.dump(f"{PUB}/song2.json")

song1(); song2()
