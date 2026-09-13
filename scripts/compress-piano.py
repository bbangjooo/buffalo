"""Build versioned, stereo MP3 samples; keep the original bank for reproducibility."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'public/audio/piano'

def main():
    source = json.loads((BANK / 'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='buffalo-piano-') as temporary:
        temporary = Path(temporary)
        def convert(sample):
            target = temporary / sample['file']
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(BANK / sample['file']),
                            '-c:a', 'libmp3lame', '-q:a', '5', '-ar', '44100', '-ac', '2',
                            '-map_metadata', '-1', str(target)], check=True)
            data = target.read_bytes()
            stream = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(target)]))['streams'][0]
            return {**sample, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                    'channels': stream['channels'], 'durationSeconds': float(stream['duration'])}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            samples = list(pool.map(convert, source['samples']))
        fingerprint = hashlib.sha256(''.join(s['sha256'] for s in samples).encode()).hexdigest()[:12]
        directory = BANK / ('compact-' + fingerprint)
        directory.mkdir(exist_ok=True)
        for sample in samples:
            (directory / sample['file']).write_bytes((temporary / sample['file']).read_bytes())
        manifest = {'instrument': source['instrument'], 'author': source['author'],
                    'license': source['license'], 'sourceManifest': '../manifest.json',
                    'changes': 'Re-encoded existing stereo MP3 samples with libmp3lame VBR quality 5, 44.1 kHz. No further trimming or mono conversion.',
                    'totalAudioBytes': sum(s['bytes'] for s in samples),
                    'samples': [{k: s[k] for k in ('file', 'bytes', 'sha256', 'midi', 'velocityLayer', 'channels', 'durationSeconds')} for s in samples]}
        (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        sizes = [next(s['bytes'] for s in samples if s['midi'] == midi and s['velocityLayer'] == layer)
                 for midi in range(21, 109, 3) for layer in (5, 11)]
        design = ROOT / 'src/design/piano-samples.ts'
        text = design.read_text()
        start, end = '// BEGIN GENERATED BANK', '// END GENERATED BANK'
        generated = f"{start}\nexport const PIANO_BANK_PATH = '/audio/piano/{directory.name}';\nconst SAMPLE_BYTES = {json.dumps(sizes)};\n{end}"
        if start in text:
            text = text[:text.index(start)] + generated + text[text.index(end) + len(end):]
        else:
            text = generated + '\n' + text
        design.write_text(text)
        print(json.dumps({'directory': str(directory.relative_to(ROOT)), 'bytes': manifest['totalAudioBytes'], 'originalBytes': source['totalAudioBytes']}))

if __name__ == '__main__':
    main()
