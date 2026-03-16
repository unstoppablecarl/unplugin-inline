// @__INLINE__
function transformPoint(x: number, y: number, z: number, ctx: { matrix: Float32Array, mode: string }): number {
  const m = ctx.matrix;

  // Logic switching often triggers V8 "Bailouts" for inlining
  // because the function body becomes "complex."
  if (ctx.mode === 'projective') {
    const tw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const tx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / tw;
    const ty = (m[1] * x + m[5] * y + m[9] * z + m[13]) / tw;
    const tz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / tw;
    return Math.sqrt(tx * tx + ty * ty + tz * tz);
  } else {
    // Standard affine transform
    const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
    const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
    return Math.sqrt(tx * tx + ty * ty + tz * tz);
  }
}

export function run(vertices: Float32Array, ctx: { matrix: Float32Array, mode: string }): number {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    sum += transformPoint(vertices[i], vertices[i + 1], vertices[i + 2], ctx);
  }
  return sum;
}