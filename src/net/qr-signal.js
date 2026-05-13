import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { compressSdp, decompressSdp, bytesToB64, b64ToBytes } from './sdp.js';

const CHUNK_SIZE = 220;
const FRAME_MS = 220;

function randomSession() {
  return Math.random().toString(36).slice(2, 6);
}

export async function sdpToFrames(sdp) {
  const compressed = await compressSdp(sdp);
  const b64 = bytesToB64(compressed);
  const session = randomSession();
  const frames = [];
  const total = Math.ceil(b64.length / CHUNK_SIZE);
  for (let i = 0; i < total; i++) {
    const payload = b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    frames.push(`${session}|${i}|${total}|${payload}`);
  }
  return frames;
}

export function startQrLoop(canvas, frames) {
  let idx = 0;
  const draw = () => {
    QRCode.toCanvas(canvas, frames[idx], { errorCorrectionLevel: 'M', margin: 1, width: 320 });
    idx = (idx + 1) % frames.length;
  };
  draw();
  const handle = setInterval(draw, FRAME_MS);
  return () => clearInterval(handle);
}

export async function scanFramesToSdp(containerId, onProgress) {
  const scanner = new Html5Qrcode(containerId, { verbose: false });
  const collected = new Map();
  let session = null;
  let total = null;

  const sdp = await new Promise(async (resolve, reject) => {
    const onScan = async (decoded) => {
      const parts = decoded.split('|');
      if (parts.length !== 4) return;
      const [s, iStr, nStr, payload] = parts;
      const i = parseInt(iStr, 10);
      const n = parseInt(nStr, 10);
      if (Number.isNaN(i) || Number.isNaN(n)) return;
      if (session === null) {
        session = s;
        total = n;
      }
      if (s !== session) return;
      if (collected.has(i)) return;
      collected.set(i, payload);
      onProgress?.(collected.size, total);
      if (collected.size === total) {
        const ordered = [];
        for (let k = 0; k < total; k++) ordered.push(collected.get(k));
        const bytes = b64ToBytes(ordered.join(''));
        try {
          const sdp = await decompressSdp(bytes);
          resolve(sdp);
        } catch (e) {
          reject(e);
        }
      }
    };

    try {
      const cams = await Html5Qrcode.getCameras();
      const cam = cams.find((c) => /back|rear|environment/i.test(c.label)) || cams[0];
      await scanner.start(
        cam ? cam.id : { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 260, height: 260 } },
        onScan,
        () => {}
      );
    } catch (e) {
      reject(e);
    }
  });

  try { await scanner.stop(); } catch {}
  try { scanner.clear(); } catch {}
  return sdp;
}
