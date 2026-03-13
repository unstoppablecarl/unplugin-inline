// @__INLINE__
function isPositive(n: number) {
  if (n > 0) return true
  return false
}

export const pos = isPositive(10)
export const neg = isPositive(-5)
