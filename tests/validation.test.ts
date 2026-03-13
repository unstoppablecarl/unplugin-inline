import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundleAndRun, bundleAndRunSilent } from './_helpers'

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

    expect(caughtError).toBeDefined()
    expect(caughtError.errors).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

    expect(errorText).toContain('Validation failed')
    expect(errorText).toContain('Cannot inline async function \'doAsync\'')
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

    expect(caughtError).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

    expect(errorText).toContain('Cannot inline generator function \'doGen\'')
  })

  it('should throw an error when the function uses the this keyword', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'this-bailout.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

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

    expect(caughtError).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

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

    expect(caughtError).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

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

    expect(caughtError).toBeDefined()

    const firstError = caughtError.errors[0]
    const errorText = firstError.text

    expect(errorText).toContain('Cannot inline function \'updateOuter\': mutates outer scope variable \'counter\'.')
  })

  it('should throw an error when used in a short-circuiting expression', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'short-circuit.ts')

    try {
      await bundleAndRunSilent(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeDefined()
    const errorText = caughtError.errors[0].text

    expect(errorText).toContain('Usage Error')
    expect(errorText).toContain('short-circuiting expression')
  })
})