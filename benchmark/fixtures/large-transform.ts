// @__INLINE__
const transform = (x: number): number => {
  // Enough unique operations to exceed V8's ~500-bytecode inlining budget (and often the cumulative budget too).
  // Every step depends on the previous result → no constant folding, no reordering.
  // Bitwise + imul + |0 keep everything in Smi/int32 path.
  let v = x | 0
  v = (v ^ 0xdeadbeef) | 0
  v = (v + 0x9e3779b9) | 0
  v = (v ^ (v >>> 16)) | 0
  v = Math.imul(v, 0x85ebca6b)
  v = (v ^ (v >>> 13)) | 0
  v = Math.imul(v, 0xc2b2ae35)
  v = (v ^ (v >>> 16)) | 0
  v = (v + 0x6c62272e) | 0
  v = (v ^ (v >>> 7)) | 0
  v = Math.imul(v, 0x27d4eb2f)
  v = (v ^ (v >>> 15)) | 0
  v = (v + 0x165667b1) | 0
  v = (v ^ (v >>> 4)) | 0
  v = Math.imul(v, 0xb5c4bcb)
  v = (v ^ (v >>> 16)) | 0
  v = (v + 0x85ebca77) | 0
  v = (v ^ (v >>> 11)) | 0
  v = Math.imul(v, 0x4a69a30d)
  v = (v ^ (v >>> 8)) | 0
  v = (v + 0x27d4eb2f) | 0
  v = (v ^ (v >>> 14)) | 0
  v = Math.imul(v, 0xc4ceb9fe)
  v = (v ^ (v >>> 16)) | 0
  v = (v + 0x846ca68b) | 0
  v = (v ^ (v >>> 9)) | 0
  v = Math.imul(v, 0xd2a98b26)
  v = (v ^ (v >>> 12)) | 0
  v = (v + 0x60d5a7d9) | 0
  v = (v ^ (v >>> 5)) | 0
  return v >>> 0
}

export const run = (x: number): number => {
  // 32 calls × call overhead = much more visible gap when V8 refuses to inline
  let total = 0
  for (let i = 0; i < 32; i++) {
    total += transform(x + i)
  }
  return total >>> 0
}