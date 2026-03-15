import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundle, bundleSilent } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

// @TODO add check for each that function does not exist in code

describe('Compilation Tests: Code Transformation', () => {
  it('should inline a simple function returning a literal', async () => {
    const target = path.join(fixturesDir, 'simple-add.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should inline a simple arrow function returning a literal', async () => {
    const target = path.join(fixturesDir, 'simple-add-arrow.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should handle functions with no return value (void)', async () => {
    const target = path.join(fixturesDir, 'void-function.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should handle multiple return statements', async () => {
    const target = path.join(fixturesDir, 'early-return.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should not inline functions without @inline comment', async () => {
    const target = path.join(fixturesDir, 'no-inline.ts')
    const output = await bundle(target)
    expect(output).toContain('function keepMe')
    expect(output).toContain('keepMe()')
    expect(output).toMatchSnapshot(target)
  })

  it('should properly scope variables to avoid collisions', async () => {
    const target = path.join(fixturesDir, 'variable-collision.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
    expect(output).toMatch(/const .*?x.*? = 5;/im)
    expect(output).toMatch(/const .*?x.*? = 100;/im)
  })

  it('should correct loop scoping when inlined inside a loop', async () => {
    const target = path.join(fixturesDir, 'loop-scoping.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should handle parameter mapping correctly', async () => {
    const target = path.join(fixturesDir, 'complex-params.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should allow custom inline identifier', async () => {
    const target = path.join(fixturesDir, 'custom-identifier.ts')
    const output = await bundle(target, { inlineIdentifier: '@custom-inline' })
    expect(output).toMatchSnapshot(target)
    expect(output).not.toContain('function subtract')
  })

  it('should work on plain JS files (without TS syntax)', async () => {
    const target = path.join(fixturesDir, 'plain-js.js')
    const output = await bundleSilent(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should work on nested function calls', async () => {
    const target = path.join(fixturesDir, 'nested-inline-calls.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should work on nested functions', async () => {
    const target = path.join(fixturesDir, 'nested-function.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should work on missing arguments', async () => {
    const target = path.join(fixturesDir, 'missing-arguments.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should work on global function dependencies', async () => {
    const target = path.join(fixturesDir, 'math-global.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should work on imported inlined functions', async () => {
    const target = path.join(fixturesDir, 'imported-function.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })

  it('should inline cross-file arrow functions and clean up unexported ones', async () => {
    const target = path.join(fixturesDir, 'import-arrow.ts')
    const output = await bundle(target)
    expect(output).toMatchSnapshot(target)
  })
})
