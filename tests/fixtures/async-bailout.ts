/* @__INLINE__ */
async function doAsync() {
  const result = await Promise.resolve(1)

  return result
}

doAsync()