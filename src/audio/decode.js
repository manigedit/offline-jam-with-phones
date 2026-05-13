let ctx = null;

export function getAudioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return ctx;
}

export async function resumeAudio() {
  const c = getAudioContext();
  if (c.state === 'suspended') {
    try { await c.resume(); } catch {}
  }
}

export async function decodeBlob(blob) {
  const c = getAudioContext();
  const buf = await blob.arrayBuffer();
  return await c.decodeAudioData(buf);
}
