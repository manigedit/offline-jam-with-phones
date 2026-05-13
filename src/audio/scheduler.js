import { getAudioContext } from './decode.js';

let currentSource = null;
let currentTrackId = null;
let scheduledStartCtxTime = 0;
let scheduledOffsetSec = 0;

export function stopCurrent() {
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource.disconnect();
    currentSource = null;
  }
  currentTrackId = null;
}

export function playAtLocalTime(buffer, trackId, atLocalMs, offsetSec = 0, meta = null) {
  stopCurrent();
  const ctx = getAudioContext();
  const nowLocalMs = performance.now();
  const deltaSec = Math.max(0, (atLocalMs - nowLocalMs) / 1000);
  const when = ctx.currentTime + deltaSec;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(when, offsetSec);
  currentSource = src;
  currentTrackId = trackId;
  scheduledStartCtxTime = when - offsetSec;
  scheduledOffsetSec = offsetSec;
  src.onended = () => {
    if (currentSource === src) {
      currentSource = null;
      currentTrackId = null;
      clearMediaSession();
    }
  };
  if (meta) updateMediaSession(meta);
  return src;
}

function updateMediaSession(meta) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title || 'Unknown',
      artist: meta.artist || 'Audio Party'
    });
    navigator.mediaSession.playbackState = 'playing';
  } catch {}
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.playbackState = 'none'; } catch {}
}

export function getCurrentTrackId() { return currentTrackId; }

export function getPlaybackPosition() {
  if (!currentSource) return null;
  const ctx = getAudioContext();
  return Math.max(0, ctx.currentTime - scheduledStartCtxTime);
}
