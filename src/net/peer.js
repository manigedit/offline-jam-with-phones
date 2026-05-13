function waitIceComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 4000);
  });
}

export async function createOffer() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = pc.createDataChannel('party', { ordered: true });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  return { pc, channel, sdp: pc.localDescription.sdp };
}

export async function createAnswer(offerSdp) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channelPromise = new Promise((resolve) => {
    pc.addEventListener('datachannel', (e) => resolve(e.channel));
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  return { pc, channelPromise, sdp: pc.localDescription.sdp };
}

export async function applyAnswer(pc, answerSdp) {
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
}

export function waitChannelOpen(channel) {
  return new Promise((resolve, reject) => {
    if (channel.readyState === 'open') return resolve();
    channel.addEventListener('open', () => resolve(), { once: true });
    channel.addEventListener('error', (e) => reject(e), { once: true });
    setTimeout(() => reject(new Error('channel open timeout')), 15000);
  });
}
