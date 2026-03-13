// @__INLINE__
function square(n: number) {
  const res = n * n
  return res
}

const results = []
for (let i = 0; i < 3; i++) {
  results.push(square(i))
}
export const output = results
