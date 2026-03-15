// @__INLINE__
const complexProcessor = (type: string, val: number) => {
  // A large switch statement often pushes a function over the
  // inlining "budget" due to the jump table bytecode generated.
  switch (type) {
    case 'add':
      return val + 1
    case 'sub':
      return val - 1
    case 'mul':
      return val * 2
    case 'div':
      return val / 2
    case 'pow':
      return val * val
    case 'mod':
      return val % 2
    case 'neg':
      return -val
    case 'abs':
      return Math.abs(val)
    case 'sin':
      return Math.sin(val)
    case 'cos':
      return Math.cos(val)
    // Add many more cases to bloat the bytecode
    case 'log':
      return Math.log(val)
    case 'sqrt':
      return Math.sqrt(val)
    case 'ceil':
      return Math.ceil(val)
    case 'floor':
      return Math.floor(val)
    case 'round':
      return Math.round(val)
    case 'exp':
      return Math.exp(val)
    case 'tan':
      return Math.tan(val)
    case 'atan':
      return Math.atan(val)
    default:
      return val
  }
}

export const run = (a: number, b: number, c: number) => {
  return complexProcessor('add', a) +
    complexProcessor('mul', b) +
    complexProcessor('pow', c)
}
