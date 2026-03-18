/** @__INLINE_MACRO__ */
const badMacro = (a: number) => {
  const temp = a * 2
  return temp
}

export const val = badMacro(10)