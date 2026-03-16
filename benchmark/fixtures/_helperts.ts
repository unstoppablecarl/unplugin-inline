/**
 * Generates test data for the 3D Point Transformation fixture.
 * @param vertexCount The number of [x, y, z] points to generate.
 */
export function randomVectorMatrixData(vertexCount: number = 10000) {
  // 3 components (x, y, z) per vertex
  const vertices = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertices.length; i++) {
    // Random coordinates between -100 and 100
    vertices[i] = (Math.random() - 0.5) * 200
  }

  // Standard 4x4 matrix (16 elements)
  const matrix = new Float32Array(16)
  for (let i = 0; i < 16; i++) {
    // Random weights between -1 and 1
    matrix[i] = (Math.random() - 0.5) * 2
  }

  // Ensure the 'tw' divisor (matrix[15] usually) isn't zero to avoid Infinity
  if (matrix[15] === 0) matrix[15] = 1.0

  const mode = Math.random() < 0.5 ? 'basic' : 'projective'

  return { vertices, ctx: { mode, matrix } }
}

export const randomInt = () => (Math.random() * 255 + 1) | 0
