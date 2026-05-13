import { send, sendBinary, parseBinary, MSG } from './protocol.js';

const CHUNK_SIZE = 16 * 1024;
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

function waitForDrain(channel) {
  return new Promise((resolve) => {
    if (channel.bufferedAmount <= LOW_WATER) return resolve();
    channel.bufferedAmountLowThreshold = LOW_WATER;
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
  });
}

export async function sendFile(channel, file, trackId, onProgress) {
  send(channel, MSG.FILE_HEADER, {
    trackId,
    name: file.name,
    mime: file.type || 'audio/mpeg',
    size: file.size
  });
  let offset = 0;
  let idx = 0;
  const reader = file.stream().getReader();
  let pending = new Uint8Array(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const merged = new Uint8Array(pending.length + value.length);
    merged.set(pending);
    merged.set(value, pending.length);
    pending = merged;
    while (pending.length >= CHUNK_SIZE) {
      const chunk = pending.slice(0, CHUNK_SIZE);
      pending = pending.slice(CHUNK_SIZE);
      if (channel.bufferedAmount > HIGH_WATER) await waitForDrain(channel);
      sendBinary(channel, { trackId, idx }, chunk.buffer);
      offset += chunk.length;
      idx++;
      onProgress?.(offset, file.size);
    }
  }
  if (pending.length > 0) {
    if (channel.bufferedAmount > HIGH_WATER) await waitForDrain(channel);
    sendBinary(channel, { trackId, idx }, pending.buffer);
    offset += pending.length;
    onProgress?.(offset, file.size);
  }
  send(channel, MSG.FILE_DONE, { trackId });
}

export function createReceiver({ onHeader, onProgress, onComplete }) {
  const incoming = new Map();
  return function handleMessage(e) {
    if (typeof e.data === 'string') {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === MSG.FILE_HEADER) {
        incoming.set(msg.trackId, {
          header: msg,
          chunks: [],
          received: 0
        });
        onHeader?.(msg);
      } else if (msg.type === MSG.FILE_DONE) {
        const t = incoming.get(msg.trackId);
        if (!t) return;
        const blob = new Blob(t.chunks, { type: t.header.mime });
        incoming.delete(msg.trackId);
        onComplete?.(t.header, blob);
      }
    } else if (e.data instanceof ArrayBuffer) {
      const { header, body } = parseBinary(e.data);
      const t = incoming.get(header.trackId);
      if (!t) return;
      t.chunks.push(body);
      t.received += body.byteLength;
      onProgress?.(header.trackId, t.received, t.header.size);
    }
  };
}
