export async function compressSdp(sdp) {
  const stream = new Blob([sdp]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function decompressSdp(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2];
    s += B64[((a & 3) << 4) | ((b || 0) >> 4)];
    s += i + 1 < bytes.length ? B64[(((b || 0) & 15) << 2) | ((c || 0) >> 6)] : '=';
    s += i + 2 < bytes.length ? B64[(c || 0) & 63] : '=';
  }
  return s;
}

export function b64ToBytes(s) {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    bytes[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) bytes[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) bytes[o++] = ((c & 3) << 6) | d;
  }
  return bytes.subarray(0, o);
}
