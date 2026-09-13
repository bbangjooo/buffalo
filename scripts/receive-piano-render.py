"""Local-only receiver for the authoring page. Writes one known WAV, never app data."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / '.vercel/piano-render/render.wav'

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5173')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        size = int(self.headers.get('Content-Length', 0))
        if self.path != '/render.wav' or self.headers.get('Origin') != 'http://127.0.0.1:5173' or not 44 < size < 100_000_000:
            self.send_error(400)
            return
        data = self.rfile.read(size)
        if len(data) != size or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            self.send_error(400)
            return
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_bytes(data)
        self.send_response(201)
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5173')
        self.end_headers()

if __name__ == '__main__':
    print('Local piano render receiver: 127.0.0.1:5182', flush=True)
    HTTPServer(('127.0.0.1', 5182), Handler).serve_forever()
