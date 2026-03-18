/** @__INLINE_MACRO__ */
const blendAlpha = (a: number, b: number) => (a * b + 128) >> 8

export const val1 = blendAlpha(101, 255)

const x = 95
const y = 222
export const val2 = blendAlpha(x, y)
