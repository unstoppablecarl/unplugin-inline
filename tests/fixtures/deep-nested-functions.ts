// @__INLINE__
const level1 = (val: number) => val + 1
// @__INLINE__
const level2 = (val: number) => level1(val) * 2
// @__INLINE__
const level3 = (val: number) => level2(val) - 3
// @__INLINE__
const level4 = (val: number) => level3(val) / 2
// @__INLINE__
const level5 = (val: number) => Math.sqrt(Math.abs(level4(val)))

export const result = level5(99)