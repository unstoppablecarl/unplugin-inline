function subtract(a: number, b: number) {
  return a - b
}

// Only this call should be inlined
export const inlined = /* @__INLINE__ */ subtract(10, 5)

// This call should remain a standard function call
export const standard = subtract(10, 2)