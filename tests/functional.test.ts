import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundleAndRun, bundleAndRunSilent } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('Functional Tests: Execution and Logic', () => {
  it('should return correct value from inlined simple function', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'simple-add.ts'))
    expect((exports as any).result).toBe(30)
  })

  it('should return correct value from inlined simple arrow function', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'simple-add-arrow.ts'))
    expect((exports as any).result).toBe(15)
  })

  it('should handle logic with early returns', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'early-return.ts'))
    expect((exports as any).pos).toBe(true)
    expect((exports as any).neg).toBe(false)
  })

  it('should handle complex parameters and order of evaluation', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'complex-params.ts'))
    expect((exports as any).result).toBe(2)
    expect((exports as any).finalCounter).toBe(2)
  })

  it('should handle variables declared inside inlined function avoiding collision', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'variable-collision.ts'))
    expect((exports as any).outerX).toBe(100)
    expect((exports as any).innerX).toBe(5)
  })

  it('should correct loop scoping when inlined inside a loop', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'loop-scoping.ts'))
    expect((exports as any).output).toEqual([0, 1, 4])
  })

  it('should handle nested function calls', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'nested-inline-calls.ts'))
    expect((exports as any).val).toBe(40)
  })

  it('should handle deep nested functions', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'deep-nested-functions.ts'))
    expect((exports as any).run(99)).toEqual(9.924716620639604)
  })

  it('should handle undefined return (void function)', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'void-function.ts'))
    expect((exports as any).res).toBeUndefined()
    expect((exports as any).finalSideEffect).toEqual({ a: 3 })
  })

  it('should report a structured error for directly recursive functions', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'recursive-function-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeDefined()
    expect(caughtError.errors).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

    expect(errorText).toContain('Validation failed')
    expect(errorText).toContain('Cannot inline function \'factorial\': recursive calls are not supported.')

    // Verify the exact file path, line, and column are in the formatted string
    expect(errorText).toContain(fixturePath)
    // Assuming the recursive call is on line 4, column 13:
    expect(errorText).toContain(':2:0')
  })

  it('should skip transforming nested functions inside the inlined body', async () => {
    const fixturePath = path.join(fixturesDir, 'nested-function.ts')
    const result = await bundleAndRun(fixturePath)

    // 5 + 10 = 15
    expect((result.exports as any).result).toBe(15)

    // Verify the inner return statement was NOT transformed into a break/label
    // It should still look like a standard return because it belongs to the arrow function
    expect(result.code).toMatch(/return x \+ .*?val.*?/)
  })

  it('should default missing arguments to undefined', async () => {
    const fixturePath = path.join(fixturesDir, 'missing-arguments.ts')
    const result = await bundleAndRun(fixturePath)

    expect((result.exports as any).result).toBe(10)
  })

  it('should work on imported inlined functions', async () => {
    const fixturePath = path.join(fixturesDir, 'imported-function.ts')
    const result = await bundleAndRun(fixturePath)

    expect((result.exports as any).result).toBe(3)
  })

  it('should inline cross-file arrow functions and clean up unexported ones', async () => {
    const fixturePath = path.join(fixturesDir, 'import-arrow.ts')

    const { exports } = await bundleAndRun(fixturePath)

    // 1. Verify the math executed correctly after inlining
    expect((exports as any).addResult).toBe(30)
    expect((exports as any).multiplyResult).toBe(50)
  })

  it('should handle parameter destructuring', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'destructuring-params.ts'))
    expect((exports as any).result).toBe(6)
  })

  it('should handle default parameters', async () => {
    const { exports } = await bundleAndRun(path.join(fixturesDir, 'default-params.ts'))
    expect((exports as any).result).toBe(15)
  })

  it('should handle multiple inline calls in a single statement', async () => {
    const fixturePath = path.join(fixturesDir, 'multiple-calls-on-one-line.ts')
    const bundleResult = await bundleAndRun(fixturePath)
    const exports = bundleResult.exports as any

    // 30 + 10 + 3 = 43
    expect(exports.result).toBe(43)
  })

  describe('@__INLINE_MACRO__', () => {
    it('should directly inline pure expressions', async () => {
      const { exports } = await bundleAndRun(path.join(fixturesDir, 'macro-basic.ts'))
      // (100 * 255 + 128) >> 8 === 100
      expect((exports as any).val1).toBe(101)
      expect((exports as any).val2).toBe(82)

    })

    it('should wrap arguments in parentheses to preserve operator precedence', async () => {
      const { exports } = await bundleAndRun(path.join(fixturesDir, 'macro-precedence.ts'))
      // (5 + 5) * 2 === 20. If it failed precedence, it would be 15.
      expect((exports as any).val).toBe(20)
    })

    it('should allow side-effect arguments if the parameter is referenced exactly once', async () => {
      const { exports } = await bundleAndRun(path.join(fixturesDir, 'macro-side-effect-safe.ts'))
      // 10 + 1 === 11
      expect((exports as any).val).toBe(11)
      // i should only be incremented once
      expect((exports as any).finalI).toBe(11)
    })
  })

})
