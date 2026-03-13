/* @__INLINE__ */
function withNested(val: number) {
  // This nested function should be ignored by the transformer
  const innerAdder = (x: number) => {
    return x + val
  }

  return innerAdder(10)
}

export const result = withNested(5)