// @__INLINE__
const transform = (x: number): number => {
  // Enough unique operations to exceed V8's ~460-bytecode inlining budget.
  // Every operation depends on the previous result so:
  //   1. V8 cannot constant-fold any of it (input is unknown at JIT time)
  //   2. The compiler cannot reorder or drop intermediate values
  // Bitwise ops are used deliberately — they force integer representation
  // (Smi in V8 terms) which prevents the float-path shortcuts that would
  // reduce the bytecode footprint and sneak back under the budget.
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

export const run = (x: number): number => transform(x)
/*
The operations are all drawn from real hash-mixing steps (Murmur3, xxHash) so the sequence is defensible — it's not artificially padded, it just happens to be a legitimately large function. A few things worth noting about why each choice matters:
Math.imul forces an integer multiply bytecode that V8 cannot fold with the surrounding operations, adding disproportionate bytecode weight relative to what it looks like in source.
| 0 after every step keeps V8 in Smi/int32 representation throughout. Without it, V8 may widen to float64 and optimize multiple steps together, reducing bytecode count and accidentally slipping back under budget.
>>> 0 on the return converts to uint32, making the output unsigned — this is important for the validation step in eachCase since signed/unsigned -1 vs 4294967295 would cause a spurious Object.is mismatch between the standard and inlined builds.
 */
