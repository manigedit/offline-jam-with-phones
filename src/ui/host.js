import { createAnswer, waitChannelOpen } from '../net/peer.js';
import { sdpToFrames, startQrLoop, scanFramesToSdp } from '../net/qr-signal.js';
import { send, MSG } from '../net/protocol.js';
import { sendFile } from '../net/transfer.js';
import { decodeBlob, resumeAudio } from '../audio/decode.js';
import { playAtLocalTime, stopCurrent } from '../audio/scheduler.js';
import { handlePingOnHost } from '../sync/clock.js';

const peers = [];
const tracks = [];
let mode = 'idle';
let root = null;

const playback = {
  trackId: null,
  hostStartTime: 0,
  offsetSec: 0
};

const SCHEDULE_HEADROOM_MS = 500;

function back() { location.hash = ''; }

function fmtPct(n, d) { return d > 0 ? Math.floor((n / d) * 100) + '%' : '0%'; }

function render() {
  if (!root) return;
  if (mode === 'idle') return renderIdle();
  if (mode === 'scan-offer') return renderScanOffer();
  if (mode === 'show-answer') return renderShowAnswer();
}

function renderIdle() {
  root.innerHTML = `
    <button class="secondary" id="back">← Home</button>
    <h1>Host</h1>
    <div class="row">
      <button id="addFriend">+ Add friend</button>
      <button class="secondary" id="addSongs">+ Add songs</button>
    </div>
    <input type="file" id="filePicker" accept="audio/*" multiple class="hidden" />

    <h2>Friends (${peers.length})</h2>
    <div class="peer-list" id="peers"></div>

    <h2>Songs (${tracks.length})</h2>
    <div id="tracks"></div>

    <div id="controls"></div>
  `;
  root.querySelector('#back').onclick = back;
  root.querySelector('#addFriend').onclick = startPairing;
  root.querySelector('#addSongs').onclick = () => root.querySelector('#filePicker').click();
  root.querySelector('#filePicker').onchange = onFilesPicked;
  renderPeers();
  renderTracks();
  renderControls();
}

function renderPeers() {
  const el = root?.querySelector('#peers');
  if (!el) return;
  if (peers.length === 0) {
    el.innerHTML = '<p class="muted">No friends yet. Tap "+ Add friend" to pair one.</p>';
    return;
  }
  el.innerHTML = '';
  peers.forEach((p) => {
    const total = tracks.length;
    const done = [...p.transfers.values()].filter((t) => t.done).length;
    const cur = [...p.transfers.values()].find((t) => !t.done);
    const curLine = cur ? `<div class="muted">Sending ${cur.name}: ${fmtPct(cur.sent, cur.total)}</div>` : '';
    const syncLine = p.synced
      ? `<div class="muted">offset ${p.offset.toFixed(1)} ms · rtt ${p.rtt.toFixed(1)} ms</div>`
      : `<div class="muted">syncing clock…</div>`;
    const row = document.createElement('div');
    row.className = 'peer';
    row.innerHTML = `
      <div style="flex:1">
        <div>${p.name}</div>
        <div class="muted">${p.state} · ${done}/${total} songs</div>
        ${curLine}
        ${syncLine}
      </div>
    `;
    el.appendChild(row);
  });
}

function renderTracks() {
  const el = root?.querySelector('#tracks');
  if (!el) return;
  if (tracks.length === 0) {
    el.innerHTML = '<p class="muted">No songs yet. Tap "+ Add songs" to pick from your phone.</p>';
    return;
  }
  el.innerHTML = '';
  tracks.forEach((t) => {
    const row = document.createElement('div');
    const isPlaying = playback.trackId === t.id;
    row.className = 'track' + (isPlaying ? ' playing' : '');
    row.innerHTML = `
      <div class="name">${t.name}${t.buffer ? '' : ' <span class="muted">(decoding…)</span>'}</div>
      <button class="secondary" style="width:auto;padding:8px 12px" ${t.buffer ? '' : 'disabled'}>${isPlaying ? 'Stop' : 'Play'}</button>
    `;
    row.querySelector('button').onclick = () => {
      if (isPlaying) broadcastStop();
      else broadcastPlay(t);
    };
    el.appendChild(row);
  });
}

function renderControls() {
  const el = root?.querySelector('#controls');
  if (!el) return;
  if (!playback.trackId) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card">
      <h2>Now playing</h2>
      <div class="row">
        <button class="secondary" id="stop">Stop all</button>
      </div>
    </div>
  `;
  el.querySelector('#stop').onclick = broadcastStop;
}

function renderScanOffer() {
  root.innerHTML = `
    <button class="secondary" id="cancel">Cancel</button>
    <h1>Scan friend's QR</h1>
    <p>Point your camera at the QR shown on your friend's phone.</p>
    <div id="scanner" class="scanner"></div>
    <div class="status" id="status"><span class="dot warn"></span><span>Waiting for first frame…</span></div>
  `;
  root.querySelector('#cancel').onclick = () => { mode = 'idle'; render(); };
}

function renderShowAnswer() {
  root.innerHTML = `
    <button class="secondary" id="cancel">Cancel</button>
    <h1>Friend scans this</h1>
    <p>Show this code to your friend's phone.</p>
    <div class="qr-wrap"><canvas id="qr"></canvas></div>
    <div class="status"><span class="dot warn"></span><span>Waiting for connection…</span></div>
  `;
  root.querySelector('#cancel').onclick = () => { mode = 'idle'; render(); };
}

async function startPairing() {
  await resumeAudio();
  mode = 'scan-offer';
  render();

  let offerSdp;
  try {
    offerSdp = await scanFramesToSdp('scanner', (got, total) => {
      const s = root.querySelector('#status');
      if (s) s.innerHTML = `<span class="dot warn"></span><span>Got ${got} / ${total} frames</span>`;
    });
  } catch (e) {
    alert('Scan cancelled or failed: ' + e.message);
    mode = 'idle';
    render();
    return;
  }
  if (mode !== 'scan-offer') return;

  const { pc, channelPromise, sdp: answerSdp } = await createAnswer(offerSdp);
  mode = 'show-answer';
  render();

  const canvas = root.querySelector('#qr');
  const frames = await sdpToFrames(answerSdp);
  const stopQr = startQrLoop(canvas, frames);

  try {
    const channel = await channelPromise;
    await waitChannelOpen(channel);
    stopQr();
    registerPeer(pc, channel);
    mode = 'idle';
    render();
  } catch (e) {
    stopQr();
    alert('Connection failed: ' + e.message);
    mode = 'idle';
    render();
  }
}

function registerPeer(pc, channel) {
  const peer = {
    id: crypto.randomUUID().slice(0, 8),
    name: 'Friend ' + (peers.length + 1),
    pc,
    channel,
    state: 'connected',
    transfers: new Map(),
    synced: false,
    offset: 0,
    rtt: 0
  };
  channel.binaryType = 'arraybuffer';

  channel.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (handlePingOnHost(channel, msg)) return;
    if (msg.type === MSG.HELLO && msg.role === 'client') {
      peer.synced = msg.synced;
      peer.offset = msg.offset ?? 0;
      peer.rtt = msg.rtt ?? 0;
      renderPeers();
      if (playback.trackId) {
        send(channel, MSG.PLAY, {
          trackId: playback.trackId,
          hostTime: playback.hostStartTime,
          offsetSec: playback.offsetSec
        });
      }
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    peer.state = pc.connectionState;
    renderPeers();
  });

  peers.push(peer);
  send(channel, MSG.HELLO, { role: 'host' });
  for (const t of tracks) sendTrackToPeer(peer, t);
}

async function sendTrackToPeer(peer, track) {
  const tx = { name: track.name, total: track.size, sent: 0, done: false };
  peer.transfers.set(track.id, tx);
  renderPeers();
  try {
    await sendFile(peer.channel, track.file, track.id, (sent, total) => {
      tx.sent = sent;
      tx.total = total;
      renderPeers();
    });
    tx.done = true;
    renderPeers();
  } catch (e) {
    tx.done = false;
    tx.error = e.message;
    renderPeers();
  }
}

async function onFilesPicked(e) {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const id = crypto.randomUUID().slice(0, 8);
    const track = { id, name: file.name, size: file.size, mime: file.type, file, buffer: null };
    tracks.push(track);
    try { track.buffer = await decodeBlob(file); } catch (err) { track.error = err.message; }
    renderTracks();
    for (const peer of peers) sendTrackToPeer(peer, track);
  }
  e.target.value = '';
  renderTracks();
}

function broadcastPlay(track) {
  if (!track.buffer) return;
  const hostTime = performance.now() + SCHEDULE_HEADROOM_MS;
  playback.trackId = track.id;
  playback.hostStartTime = hostTime;
  playback.offsetSec = 0;
  playAtLocalTime(track.buffer, track.id, hostTime, 0, { title: track.name });
  for (const peer of peers) {
    send(peer.channel, MSG.PLAY, { trackId: track.id, hostTime, offsetSec: 0 });
  }
  renderTracks();
  renderControls();
}

function broadcastStop() {
  stopCurrent();
  playback.trackId = null;
  for (const peer of peers) send(peer.channel, MSG.STOP);
  renderTracks();
  renderControls();
}

export function renderHost(el) {
  root = el;
  mode = 'idle';
  render();
}
