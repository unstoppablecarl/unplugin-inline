/* @__INLINE__ */
function multiply(a: number, b: number) {
  return a * b
}

// Both of these should be inlined, and the definition should be removed
export const res1 = multiply(2, 3)
export const res2 = multiply(4, 5)