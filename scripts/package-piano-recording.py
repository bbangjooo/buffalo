"""Encode the local OfflineAudioContext WAV into a versioned web recording."""
import array
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.vercel/piano-render'

def main():
    wav = WORK / 'render.wav'
    mp3 = WORK / 'en-avril-a-paris.mp3'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', 'libmp3lame', '-q:a', '3',
                    '-ar', '44100', '-ac', '2', '-map_metadata', '-1', str(mp3)], check=True)
    data = mp3.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    target = ROOT / 'public/audio/piano' / ('performance-' + sha[:12])
    target.mkdir(exist_ok=True)
    (target / mp3.name).write_bytes(data)
    stream = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(mp3)]))['streams'][0]
    score_path = ROOT / 'public/Piano/en-avril-a-paris.json'
    score = json.loads(score_path.read_text())
    with wave.open(str(wav), 'rb') as reader:
        pcm = array.array('h', reader.readframes(reader.getnframes()))
        if sys.byteorder != 'little':
            pcm.byteswap()
        peak = max(abs(v) for v in pcm) / 32768
    if peak >= .999:
        raise ValueError('Render clips; do not publish it.')
    manifest = {'title': score['title'], 'file': mp3.name, 'bytes': len(data), 'sha256': sha,
                'durationSeconds': float(stream['duration']), 'channels': stream['channels'], 'sampleRate': 44100,
                'notes': len(score['notes']), 'peakPCM': peak,
                'renderer': 'OfflineAudioContext with the existing AudioPlayer graph, velocity mix, envelopes, compressor and room impulse; full score scheduled without the live voice cap.',
                'sourceScore': '/Piano/en-avril-a-paris.json', 'scoreSha256': hashlib.sha256(score_path.read_bytes()).hexdigest(),
                'sourceBank': '/audio/piano/manifest.json', 'instrument': 'Salamander Grand Piano V3', 'author': 'Alexander Holm',
                'license': 'CC-BY-3.0', 'changes': 'Score rendered to stereo 44.1 kHz audio with a one-second reverb tail; MP3 libmp3lame VBR quality 3. Uses the original local bank, not compact samples.'}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    config = ROOT / 'src/design/piano-performance.ts'
    text = re.sub(r'^  audioUrl:.*\n', '', config.read_text(), flags=re.M)
    text = text.replace('  scoreUrl:', f"  audioUrl: '/audio/piano/{target.name}/{mp3.name}',\n  scoreUrl:")
    config.write_text(text)
    print(json.dumps({'path': str(target.relative_to(ROOT)), 'bytes': len(data), 'duration': manifest['durationSeconds']}))

if __name__ == '__main__':
    main()
