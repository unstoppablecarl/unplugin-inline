let counter = 0

function inc() {
  return ++counter
}

// @__INLINE__
function multiply(a: number, b: number) {
  return a * b
}

export const result = multiply(inc(), inc())
export const finalCounter = counter
