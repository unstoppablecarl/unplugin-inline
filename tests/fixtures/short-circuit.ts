/* @__INLINE__ */
function getOne() {
  return 1
}

const a = 3
// This should now trigger a "Usage Error"
const result = (a > 2) && getOne()