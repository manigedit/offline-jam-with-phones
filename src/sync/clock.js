import { send, MSG } from '../net/protocol.js';

const SAMPLE_COUNT = 20;
const SAMPLE_INTERVAL_MS = 60;
const KEEP_FRACTION = 0.25;

export function handlePingOnHost(channel, msg) {
  if (msg.type !== MSG.PING) return false;
  send(channel, MSG.PONG, { seq: msg.seq, t1: msg.t1, t2: performance.now() });
  return true;
}

export function measureClockOffset(channel, onSample) {
  return new Promise((resolve, reject) => {
    const pending = new Map();
    const samples = [];
    let seq = 0;
    let pings = 0;

    const handler = (e) => {
      if (typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== MSG.PONG) return;
      const t4 = performance.now();
      const t1 = pending.get(msg.seq);
      if (t1 === undefined) return;
      pending.delete(msg.seq);
      const offset = msg.t2 - (t1 + t4) / 2;
      const rtt = t4 - t1;
      samples.push({ offset, rtt });
      onSample?.(samples.length, SAMPLE_COUNT, rtt);
    };
    channel.addEventListener('message', handler);

    const interval = setInterval(() => {
      if (pings >= SAMPLE_COUNT) {
        clearInterval(interval);
        setTimeout(() => {
          channel.removeEventListener('message', handler);
          if (samples.length < 3) return reject(new Error('not enough sync samples'));
          samples.sort((a, b) => a.rtt - b.rtt);
          const keep = samples.slice(0, Math.max(3, Math.floor(samples.length * KEEP_FRACTION)));
          const avg = keep.reduce((s, x) => s + x.offset, 0) / keep.length;
          const bestRtt = samples[0].rtt;
          resolve({ offset: avg, rtt: bestRtt });
        }, 300);
        return;
      }
      pings++;
      seq++;
      const t1 = performance.now();
      pending.set(seq, t1);
      send(channel, MSG.PING, { seq, t1 });
    }, SAMPLE_INTERVAL_MS);
  });
}
