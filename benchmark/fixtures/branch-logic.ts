// @__INLINE__
const complexProcessor = (type: string, val: number) => {
  // Large switch → jump table bytecode easily exceeds inlining budget.
  // More cases = bigger jump table.
  switch (type) {
    case 'add':   return val + 1
    case 'sub':   return val - 1
    case 'mul':   return val * 2
    case 'div':   return val / 2
    case 'pow':   return val * val
    case 'mod':   return val % 2
    case 'neg':   return -val
    case 'abs':   return Math.abs(val)
    case 'sin':   return Math.sin(val)
    case 'cos':   return Math.cos(val)
    case 'log':   return Math.log(val)
    case 'sqrt':  return Math.sqrt(val)
    case 'ceil':  return Math.ceil(val)
    case 'floor': return Math.floor(val)
    case 'round': return Math.round(val)
    case 'exp':   return Math.exp(val)
    case 'tan':   return Math.tan(val)
    case 'atan':  return Math.atan(val)
    // Add even more if you want (30–50 cases is fine — jump table grows fast)
    case 'sinh':  return Math.sinh(val)
    case 'cosh':  return Math.cosh(val)
    case 'tanh':  return Math.tanh(val)
    case 'asin':  return Math.asin(val)
    case 'acos':  return Math.acos(val)
    default:      return val
  }
}

export const run = (a: number, b: number, c: number) => {
  let total = 0
  for (let i = 0; i < 32; i++) {
    total += complexProcessor('add', a + i) +
      complexProcessor('mul', b + i) +
      complexProcessor('pow', c + i)
  }
  return total
}