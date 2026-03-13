// @__INLINE__
function doSomething(obj: { a: number }) {
  obj.a += 1

  return
}

let input = { a: 2 }
export const res = doSomething(input)
export const finalSideEffect = input
