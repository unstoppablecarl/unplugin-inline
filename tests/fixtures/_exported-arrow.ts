// @__INLINE__
export const exportedArrowAdd = (a: number, b: number) => a + b

// @__INLINE__
const internalMultiplier = (x: number, y: number) => {
  return x * y
}

// @__INLINE__
export const useInternal = () => internalMultiplier(5, 10)