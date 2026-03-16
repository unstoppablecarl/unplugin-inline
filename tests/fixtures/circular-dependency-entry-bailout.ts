// @__INLINE__
function helper(v: number): number {
  return cycleA(v)
}

// @__INLINE__
function cycleA(v: number): number {
  return cycleB(v)
}

// @__INLINE__
function cycleB(v: number): number {
  return cycleA(v)
}

export const result = helper(10)
