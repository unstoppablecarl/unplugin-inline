import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundleAndRunSilent } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('Validation Guardrails (Bailouts)', () => {
  it('should throw an error when attempting to inline an async function', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'async-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Validation failed')
    expect(errorText).toContain(`Cannot inline function 'doAsync': async functions are not supported.`)
    expect(errorText).toContain(fixturePath)
  })

  it('should throw an error when attempting to inline a generator function', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'generator-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain(`Cannot inline function 'doGen': generator functions are not supported.`)
  })

  it('should throw an error when the function uses the this keyword', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'this-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Cannot inline function \'useThis\': uses \'this\' keyword.')
  })

  it('should throw an error when the function uses the arguments keyword', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'arguments-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Cannot inline function \'useArgs\': uses \'arguments\' keyword.')
  })

  it('should throw an error when the function assigns to an outer scope variable', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'mutation-assignment-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Cannot inline function \'mutateOuter\': mutates outer scope variable \'outerState\'.')
  })

  it('should throw an error when the function updates an outer scope variable', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'mutation-update-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Cannot inline function \'updateOuter\': mutates outer scope variable \'counter\'.')
  })

  it('should throw an error when used in a short-circuiting expression', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'short-circuit-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Cannot inline function \'getOne\': used in short-circuiting expression.')
  })

  it('should throw an error when a circular dependency is found.', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'circular-dependency-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain(`Circular dependency detected in @__INLINE__ functions: addA -> addB -> addA`)
  })

  it('should throw an error when a circular dependency chain is found.', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'circular-dependency-chain-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain(`Circular dependency detected in @__INLINE__ functions: addA -> addB -> addC -> addA`)
  })

  it('should throw an error when entering a circular dependency chain is found.', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'circular-dependency-entry-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError, 'expected error to be thrown').toBeDefined()
    expect(caughtError.errors).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain(`Circular dependency detected in @__INLINE__ functions: cycleA -> cycleB -> cycleA`)
  })

  describe('@__MACRO_INLINE__', () => {

    it('should throw a build error when an impure argument is passed to a multi-use parameter', async () => {
      let caughtError: any
      const fixturePath = path.join(fixturesDir, 'macro-side-effect-bailout.ts')

      try {
        await bundleAndRunSilent(fixturePath)
      } catch (error) {
        caughtError = error
      }

      expect(caughtError, 'expected error to be thrown').toBeDefined()
      expect(caughtError.errors).toBeDefined()
      const errorText = caughtError.errors[0].text

      expect(errorText).toContain(`Cannot safely expand macro 'square': The argument at index 0 (passed to parameter 'x') contains potential side-effects (e.g., a function call or mutation). Because 'x' is referenced 2 times in the macro body, expanding it would cause the side-effect to be evaluated 2 times instead of exactly once.`)
    })

    it('should throw a build error if the macro blueprint contains multiple statements', async () => {
      let caughtError: any
      const fixturePath = path.join(fixturesDir, 'macro-invalid-bailout.ts')

      try {
        await bundleAndRunSilent(fixturePath)
      } catch (error) {
        caughtError = error
      }

      expect(caughtError, 'expected error to be thrown').toBeDefined()
      expect(caughtError.errors).toBeDefined()
      const errorText = caughtError.errors[0].text

      expect(errorText).toContain(`Macros can only have one statement.`)
    })
  })
})