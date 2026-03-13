/* @__INLINE__ */
function useArgs() {
  const firstArg = arguments[0]

  return firstArg
}

// @ts-expect-error
useArgs(100)