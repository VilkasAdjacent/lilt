// Minimal RIFF/WAVE reader: PCM 16/24/32-bit int and 32-bit float, mono or first channel.
import { readFileSync } from "node:fs";

export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV: " + path);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), fs: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = { off: p + 8, len: Math.min(len, b.length - p - 8) };
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("bad WAV: " + path);
  const bps = fmt.bits / 8, n = Math.floor(data.len / (bps * fmt.ch));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = data.off + i * bps * fmt.ch;
    if (fmt.tag === 3 && fmt.bits === 32) x[i] = b.readFloatLE(o);
    else if (fmt.bits === 16) x[i] = b.readInt16LE(o) / 32768;
    else if (fmt.bits === 24) x[i] = b.readIntLE(o, 3) / 8388608;
    else if (fmt.bits === 32) x[i] = b.readInt32LE(o) / 2147483648;
    else throw new Error("unsupported bits " + fmt.bits);
  }
  return { fs: fmt.fs, x };
}
