import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundleAndRunRollup } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('Rollup Parity: Transformation & Validation', () => {

  it('should inline and execute plain JS correctly', async () => {
    const fixturePath = path.join(fixturesDir, 'plain-js.js')
    const result = await bundleAndRunRollup(fixturePath)

    // Verify the function declaration is gone
    expect(result.code).not.toContain('function multiply')

    // Verify the label was injected
    expect(result.code).toContain('multiplyLabel')

    // Verify the functional result (2 * 3 = 6)
    expect((result.exports as any).res).toBe(6)
  })

  it('should report validation errors in Rollup (Async)', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'async-bailout.ts')

    try {
      await bundleAndRunRollup(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError?.errors[0].text).toContain(`Cannot inline function 'doAsync': async functions are not supported.`)
  })

  it('should prevent outer scope mutation in Rollup', async () => {
    let caughtError: any
    const fixturePath = path.join(fixturesDir, 'mutation-assignment-bailout.ts')

    try {
      await bundleAndRunRollup(fixturePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError?.errors[0].text).toContain('mutates outer scope variable \'outerState\'')
  })
})