import path from 'node:path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { bundle, bundleAndRun, getSnapshotKey } from './_helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('Auto Convert Inline to Macro (autoConvertInlineToMacro)', () => {
  describe('Functional Tests', () => {
    it('should evaluate correctly when auto-converted to a macro', async () => {
      const target = path.join(fixturesDir, 'simple-add.ts')
      const options = {
        autoConvertInlineToMacro: true,
      }

      const { exports } = await bundleAndRun(target, options)

      expect((exports as any).result).toBe(30)
    })

    it('should evaluate correctly and execute side-effects exactly once when falling back to block-scope', async () => {
      const target = path.join(fixturesDir, 'auto-macro-fallback.ts')
      const options = {
        autoConvertInlineToMacro: true,
      }

      const { exports } = await bundleAndRun(target, options)

      // 5 * 5 === 25
      expect((exports as any).val).toBe(25)
      // i should only increment once, to 6
      expect((exports as any).finalI).toBe(6)
    })
  })

  describe('Compilation Tests (AST Snapshots)', () => {
    it('should output expression substitution when autoConvertInlineToMacro is true', async () => {
      const target = path.join(fixturesDir, 'simple-add.ts')
      const options = {
        autoConvertInlineToMacro: true,
      }

      const output = await bundle(target, options)

      expect(output).toContain('const result = 10 + 20')
      expect(output).toMatchSnapshot(getSnapshotKey(target) + '-converted')
    })

    it('should output block scopes when autoConvertInlineToMacro is false', async () => {
      const target = path.join(fixturesDir, 'simple-add.ts')
      const options = {
        autoConvertInlineToMacro: false,
      }

      const output = await bundle(target, options)
      expect(output).not.toContain('const result = 10 + 20')
      expect(output).toMatchSnapshot(getSnapshotKey(target) + '-standard')
    })

    it('should output block scopes even if autoConvert is true, because the argument is impure', async () => {
      const target = path.join(fixturesDir, 'auto-macro-fallback.ts')
      const options = {
        autoConvertInlineToMacro: true,
      }

      const output = await bundle(target, options)

      expect(output).toContain('break')
      // Snapshot must show block scope injection to protect the `i++` side-effect
      expect(output).toMatchSnapshot(getSnapshotKey(target) + '-fallback')
    })
  })
})