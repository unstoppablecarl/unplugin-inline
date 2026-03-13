const x = 100

// @__INLINE__
function getInnerX() {
  const x = 5
  return x
}

export const outerX = x
export const innerX = getInnerX()
