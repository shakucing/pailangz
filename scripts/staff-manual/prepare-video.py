"""Prepare screenshot-led tutorial frames and English captions from narration.

Run with the topic (scoring/stages) and an ElevenLabs MP3 path. Uses Pillow,
NumPy and macOS afconvert; render the resulting manifest with render-video.swift.
All temporary media stays in the ignored .local/staff-manual directory.
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
topic, audio_arg = sys.argv[1:3]
audio = Path(audio_arg).resolve()
guide = json.loads((ROOT / 'docs/staff-manual-tutorials.json').read_text())[topic]
temp = ROOT / '.local/staff-manual' / topic
temp.mkdir(parents=True, exist_ok=True)
out = ROOT / 'public/staff-manual/videos'
out.mkdir(parents=True, exist_ok=True)
wav = temp / 'narration.wav'
if not wav.exists() or wav.stat().st_mtime < audio.stat().st_mtime:
    subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16', str(audio), str(wav)], check=True)
with wave.open(str(wav)) as f:
    rate, channels = f.getframerate(), f.getnchannels()
    samples = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(float) / 32768
samples = samples.reshape(-1, channels).mean(axis=1)
duration = len(samples) / rate
window = max(1, int(rate * .02))
rms = np.sqrt((samples[:len(samples)//window*window].reshape(-1, window)**2).mean(axis=1))
quiet = rms < max(.008, float(np.quantile(rms, .15)))
runs, start = [], None
for i, q in enumerate([*quiet, False]):
    if q and start is None: start = i
    if not q and start is not None:
        if (i-start)*.02 >= .18: runs.append((start*.02, i*.02))
        start = None
weights = [len(s['narration']) + 18 * len(re.findall(r'[.!?]', s['narration'])) for s in guide['scenes']]
boundaries, cumulative = [0.0], 0
for w in weights[:-1]:
    cumulative += w
    expected = cumulative/sum(weights)*duration
    options = [(a+b)/2 for a,b in runs if abs((a+b)/2-expected)<4 and (a+b)/2>boundaries[-1]+4]
    boundaries.append(min(options, key=lambda x: abs(x-expected)) if options else expected)
boundaries.append(duration + .5)

def font(size, bold=False):
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf', size)

def wrapped(draw, text, f, max_width):
    lines, line = [], ''
    for word in text.split():
        candidate = (line+' '+word).strip()
        if draw.textlength(candidate, font=f)>max_width and line:
            lines.append(line); line=word
        else: line=candidate
    if line: lines.append(line)
    return lines

def textblock(draw, text, xy, f, width, fill, gap=12):
    x,y=xy
    for line in wrapped(draw,text,f,width):
        draw.text((x,y),line,font=f,fill=fill)
        y += f.size+gap
    return y

scenes=[]
for i,s in enumerate(guide['scenes']):
    canvas=Image.new('RGB',(1920,1080),'#111812');d=ImageDraw.Draw(canvas)
    lime='#d6ff50'; white='#f8fbf5'; muted='#b9c6b7'
    d.text((64,48),'PAILANGZ  /  STAFF MANUAL',font=font(25,True),fill=lime)
    d.rounded_rectangle((64,124,460,175),radius=10,fill='#24311f')
    d.text((82,136),f'TUTORIAL {1 if topic=="scoring" else 2}  •  STEP {i+1} OF {len(guide["scenes"])}',font=font(23,True),fill=lime)
    y=textblock(d,s['title'],(64,220),font(58,True),660,white,12)+50
    for j,step in enumerate(s['steps']):
        d.ellipse((66,y+5,104,y+43),fill=lime)
        d.text((78,y+10),str(j+1),font=font(21,True),fill='#111812')
        y=textblock(d,step,(127,y),font(32),580,white,12)+32
    d.line((64,926,706,926),fill='#40523b',width=2)
    d.text((64,952),'Pause the video to follow each step.',font=font(25),fill=muted)
    d.text((64,995),'Training event • Example players • English narration',font=font(19),fill=muted)
    src=ROOT / 'tmp/pdfs/screenshots' / (s['image']+'.png')
    if not src.exists(): src=ROOT / 'public/staff-manual/images' / (s['image']+'.webp')
    im=Image.open(src).convert('RGB')
    if s.get('highlight'):
        x,y,w,h=s['highlight'];mark=ImageDraw.Draw(im)
        mark.rounded_rectangle((x,y,x+w,y+h),radius=8,outline='#d66a00',width=5)
    im.thumbnail((1110,940),Image.Resampling.LANCZOS)
    x=772+(1110-im.width)//2;y=76+(940-im.height)//2
    d.rounded_rectangle((x-4,y-4,x+im.width+4,y+im.height+4),radius=14,fill='#f4f7f0')
    canvas.paste(im,(x,y))
    for j in range(len(guide['scenes'])):
        xx=772+j*1110/len(guide['scenes'])
        d.rectangle((xx,1040,xx+1110/len(guide['scenes'])-5,1047),fill=lime if j<=i else '#40523b')
    path=temp/f'{i:02}.png';canvas.save(path)
    if i==0: canvas.save(out/f'{topic}-poster.webp',quality=88)
    scenes.append({'image':str(path),'duration':round(boundaries[i+1]-boundaries[i],3)})

def ts(t):
    ms=round(t*1000);sec,ms=divmod(ms,1000);mins,sec=divmod(sec,60);hours,mins=divmod(mins,60)
    return f'{hours:02}:{mins:02}:{sec:02}.{ms:03}'

captions=['WEBVTT','']
for i,s in enumerate(guide['scenes']):
    sentences=re.split(r'(?<=[.!?])\s+',s['narration'])
    chunks=[]
    for sentence in sentences:
        words=sentence.split()
        for pos in range(0,len(words),14): chunks.append(' '.join(words[pos:pos+14]))
    total=sum(len(c) for c in chunks);t=boundaries[i]
    for c in chunks:
        end=min(duration,t+(boundaries[i+1]-boundaries[i])*len(c)/total)
        if end>t: captions.extend([f'{ts(t)} --> {ts(end)}',c,''])
        t=end
(out/f'{topic}.vtt').write_text('\n'.join(captions))
manifest={'audio':str(audio),'output':str(out/f'{topic}.mp4'),'scenes':scenes}
(temp/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'topic':topic,'duration':round(duration,2),'manifest':str(temp/'manifest.json'),'boundaries':boundaries}))
