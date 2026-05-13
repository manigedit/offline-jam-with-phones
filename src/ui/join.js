import { createOffer, applyAnswer, waitChannelOpen } from '../net/peer.js';
import { sdpToFrames, startQrLoop, scanFramesToSdp } from '../net/qr-signal.js';
import { send, MSG } from '../net/protocol.js';
import { createReceiver } from '../net/transfer.js';
import { decodeBlob, resumeAudio } from '../audio/decode.js';
import { playAtLocalTime, stopCurrent } from '../audio/scheduler.js';
import { measureClockOffset } from '../sync/clock.js';

let mode = 'idle';
let root = null;
let pc = null;
let channel = null;
let stopQr = null;
const tracks = [];

const sync = { offset: 0, rtt: 0, synced: false };
let playingId = null;
let pendingPlay = null;

function back() { location.hash = ''; }

function fmtPct(n, d) { return d > 0 ? Math.floor((n / d) * 100) + '%' : '0%'; }

function render() {
  if (!root) return;
  if (mode === 'idle') return renderIdle();
  if (mode === 'show-offer') return renderShowOffer();
  if (mode === 'scan-answer') return renderScanAnswer();
  if (mode === 'connected') return renderConnected();
}

function renderIdle() {
  root.innerHTML = `
    <button class="secondary" id="back">← Home</button>
    <h1>Join</h1>
    <p>You'll show a QR to the host, then scan one back.</p>
    <button id="start">Show my QR</button>
  `;
  root.querySelector('#back').onclick = back;
  root.querySelector('#start').onclick = startJoin;
}

function renderShowOffer() {
  root.innerHTML = `
    <button class="secondary" id="cancel">Cancel</button>
    <h1>Host scans this</h1>
    <p>Hold your phone steady so the host can scan.</p>
    <div class="qr-wrap"><canvas id="qr"></canvas></div>
    <button id="next">I've been scanned — now scan host</button>
  `;
  root.querySelector('#cancel').onclick = cancel;
  root.querySelector('#next').onclick = async () => {
    await resumeAudio();
    if (stopQr) { stopQr(); stopQr = null; }
    mode = 'scan-answer';
    render();
    doScanAnswer();
  };
}

function renderScanAnswer() {
  root.innerHTML = `
    <button class="secondary" id="cancel">Cancel</button>
    <h1>Scan host's QR</h1>
    <p>Point your camera at the QR on the host's phone.</p>
    <div id="scanner" class="scanner"></div>
    <div class="status" id="status"><span class="dot warn"></span><span>Waiting for first frame…</span></div>
  `;
  root.querySelector('#cancel').onclick = cancel;
}

function renderConnected() {
  const syncLine = sync.synced
    ? `<span class="dot ok"></span><span>Synced · offset ${sync.offset.toFixed(1)} ms · rtt ${sync.rtt.toFixed(1)} ms</span>`
    : `<span class="dot warn"></span><span>Syncing clock…</span>`;
  root.innerHTML = `
    <button class="secondary" id="back">← Home</button>
    <h1>Connected</h1>
    <div class="status" id="syncStatus">${syncLine}</div>
    <h2>Songs</h2>
    <div id="tracks"></div>
    <p class="muted">Host controls playback.</p>
  `;
  root.querySelector('#back').onclick = () => { cancel(); back(); };
  renderTracks();
}

function renderSyncStatus() {
  const el = root?.querySelector('#syncStatus');
  if (!el) return;
  el.innerHTML = sync.synced
    ? `<span class="dot ok"></span><span>Synced · offset ${sync.offset.toFixed(1)} ms · rtt ${sync.rtt.toFixed(1)} ms</span>`
    : `<span class="dot warn"></span><span>Syncing clock…</span>`;
}

function renderTracks() {
  const el = root?.querySelector('#tracks');
  if (!el) return;
  if (tracks.length === 0) {
    el.innerHTML = '<p class="muted">Waiting for the host to add songs…</p>';
    return;
  }
  el.innerHTML = '';
  tracks.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'track' + (playingId === t.id ? ' playing' : '');
    let status;
    if (!t.received) status = `<div class="muted">${fmtPct(t.bytesReceived, t.size)}</div>`;
    else if (!t.buffer) status = `<div class="muted">decoding…</div>`;
    else status = `<div class="muted">${playingId === t.id ? 'playing' : 'ready'}</div>`;
    row.innerHTML = `<div class="name">${t.name}</div>${status}`;
    el.appendChild(row);
  });
}

function cancel() {
  if (stopQr) { stopQr(); stopQr = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; }
  channel = null;
  mode = 'idle';
  render();
}

async function startJoin() {
  await resumeAudio();
  const created = await createOffer();
  pc = created.pc;
  channel = created.channel;
  channel.binaryType = 'arraybuffer';
  setupReceiver();
  setupControlHandler();
  const frames = await sdpToFrames(created.sdp);
  mode = 'show-offer';
  render();
  const canvas = root.querySelector('#qr');
  stopQr = startQrLoop(canvas, frames);
}

function setupReceiver() {
  const handler = createReceiver({
    onHeader: (header) => {
      tracks.push({
        id: header.trackId,
        name: header.name,
        mime: header.mime,
        size: header.size,
        bytesReceived: 0,
        received: false,
        buffer: null
      });
      renderTracks();
    },
    onProgress: (trackId, received) => {
      const t = tracks.find((x) => x.id === trackId);
      if (!t) return;
      t.bytesReceived = received;
      renderTracks();
    },
    onComplete: async (header, blob) => {
      const t = tracks.find((x) => x.id === header.trackId);
      if (!t) return;
      t.received = true;
      try {
        t.buffer = await decodeBlob(blob);
      } catch (e) {
        t.error = e.message;
      }
      renderTracks();
      tryApplyPendingPlay();
    }
  });
  channel.addEventListener('message', handler);
}

function setupControlHandler() {
  channel.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === MSG.PLAY) {
      pendingPlay = msg;
      tryApplyPendingPlay();
    } else if (msg.type === MSG.STOP) {
      stopCurrent();
      playingId = null;
      pendingPlay = null;
      renderTracks();
    }
  });
}

function tryApplyPendingPlay() {
  if (!pendingPlay) return;
  const t = tracks.find((x) => x.id === pendingPlay.trackId);
  if (!t || !t.buffer) return;
  const localStartMs = pendingPlay.hostTime - sync.offset;
  const nowMs = performance.now();
  let offsetSec = pendingPlay.offsetSec || 0;
  if (localStartMs < nowMs) {
    offsetSec += (nowMs - localStartMs) / 1000;
    playAtLocalTime(t.buffer, t.id, nowMs, offsetSec, { title: t.name });
  } else {
    playAtLocalTime(t.buffer, t.id, localStartMs, offsetSec, { title: t.name });
  }
  playingId = t.id;
  pendingPlay = null;
  renderTracks();
}

async function doScanAnswer() {
  let answerSdp;
  try {
    answerSdp = await scanFramesToSdp('scanner', (got, total) => {
      const s = root.querySelector('#status');
      if (s) s.innerHTML = `<span class="dot warn"></span><span>Got ${got} / ${total} frames</span>`;
    });
  } catch (e) {
    alert('Scan failed: ' + e.message);
    cancel();
    return;
  }

  try {
    await applyAnswer(pc, answerSdp);
    await waitChannelOpen(channel);
    mode = 'connected';
    render();
    runSync();
  } catch (e) {
    alert('Connection failed: ' + e.message);
    cancel();
  }
}

async function runSync() {
  try {
    const { offset, rtt } = await measureClockOffset(channel);
    sync.offset = offset;
    sync.rtt = rtt;
    sync.synced = true;
    renderSyncStatus();
    send(channel, MSG.HELLO, { role: 'client', synced: true, offset, rtt });
    tryApplyPendingPlay();
  } catch (e) {
    sync.synced = false;
    renderSyncStatus();
  }
}

export function renderJoin(el) {
  root = el;
  mode = 'idle';
  tracks.length = 0;
  playingId = null;
  pendingPlay = null;
  sync.offset = 0;
  sync.rtt = 0;
  sync.synced = false;
  render();
}
