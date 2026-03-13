/* @__INLINE__ */
function addOptional(a: number, b: any) {
  return b === undefined ? a : a + b
}

// Call with only 1 argument. 'b' will become 'undefined'.
// @ts-expect-error
export const result = addOptional(10)