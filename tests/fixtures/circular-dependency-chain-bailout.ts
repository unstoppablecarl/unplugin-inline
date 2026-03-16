// @__INLINE__
function addA(a: number): number {
  return addB(a) + 1
}

// @__INLINE__
function addB(a: number): number {
  return addC(a) + 1
}

// @__INLINE__
function addC(a: number): number {
  return addA(a) + 1
}

export const result = addA(10)
