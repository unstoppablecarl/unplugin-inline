/* @__INLINE__ */
function useThis(this: any) {
  const val = this.value

  return val
}

const dummyContext = {
  value: 42,
}

useThis.call(dummyContext)