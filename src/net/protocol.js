export const MSG = {
  ECHO: 'echo',
  PING: 'ping',
  PONG: 'pong',
  FILE_HEADER: 'fileHeader',
  FILE_DONE: 'fileDone',
  TRACK_LIST: 'trackList',
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  HELLO: 'hello'
};

export function send(channel, type, payload = {}) {
  if (channel.readyState !== 'open') return;
  channel.send(JSON.stringify({ type, ...payload }));
}

export function sendBinary(channel, header, body) {
  if (channel.readyState !== 'open') return;
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const frame = new Uint8Array(2 + headerBytes.length + body.byteLength);
  new DataView(frame.buffer).setUint16(0, headerBytes.length, true);
  frame.set(headerBytes, 2);
  frame.set(new Uint8Array(body), 2 + headerBytes.length);
  channel.send(frame);
}

export function parseBinary(buf) {
  const view = new DataView(buf);
  const headerLen = view.getUint16(0, true);
  const headerBytes = new Uint8Array(buf, 2, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  const body = buf.slice(2 + headerLen);
  return { header, body };
}
