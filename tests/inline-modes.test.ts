import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundleAndRun } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('Inlining Modes: Global vs Local', () => {

  it('should inline everywhere and remove the function when marked globally', async () => {
    const fixturePath = path.join(fixturesDir, 'inline-global.ts')
    const result = await bundleAndRun(fixturePath)

    // Check execution
    expect((result.exports as any).res1).toBe(6)
    expect((result.exports as any).res2).toBe(20)

    // Check code: function definition should be GONE
    expect(result.code).not.toContain('function multiply')
    // Should see two separate labeled blocks
    const labelCount = (result.code.match(/multiplyLabel/g) || []).length
    expect(labelCount).toBeGreaterThanOrEqual(2)
  })

  it('should only inline specific calls when marked locally', async () => {
    const fixturePath = path.join(fixturesDir, 'inline-local.ts')
    const result = await bundleAndRun(fixturePath)

    // Check execution
    expect((result.exports as any).inlined).toBe(5)
    expect((result.exports as any).standard).toBe(8)

    // Check code: function definition must persist for the standard call
    expect(result.code).toContain('function subtract')
    // Labeled block should only exist for the inlined call
    expect(result.code).toContain('subtractLabel')
    // Standard call should still exist
    expect(result.code).toContain('subtract(10, 2)')
  })

  it('should detect local inline comments even when buried in assignments', async () => {
    // This tests the 'while' loop in getInlineTarget
    const fixturePath = path.join(fixturesDir, 'plain-js.js')
    const result = await bundleAndRun(fixturePath)

    expect(result.code).toContain('multiplyLabel')
    expect((result.exports as any).res).toBe(6)
  })
})