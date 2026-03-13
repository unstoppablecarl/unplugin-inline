// @__INLINE__
function double(n: number) {
  return n * 2
}

// @__INLINE__
function quadruple(n: number) {
  return double(n) * 2
}

export const val = quadruple(10)
