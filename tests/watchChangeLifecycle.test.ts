import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import inlinePlugin from '../src'
import { normalizePath } from '../src/lib/_helpers' // Adjust path

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('watchChange Lifecycle', () => {
  const tempDir = path.resolve(__dirname, 'temp_watch_fixtures')
  const mathPath = normalizePath(path.join(tempDir, 'math.ts'))
  const mainPath = normalizePath(path.join(tempDir, 'main.ts'))

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('should clear the discovery cache and registry when a file is modified', async () => {
    // 1. Setup initial files on disk
    const initialMathCode = `
      // @__INLINE__
      export const mathOp = (a: number, b: number) => a + b;
    `
    const mainCode = `
      import { mathOp } from './math.ts';
      export const run = (x: number, y: number) => mathOp(x, y);
    `

    fs.writeFileSync(mathPath, initialMathCode, 'utf-8')
    fs.writeFileSync(mainPath, mainCode, 'utf-8')

    // 2. Initialize the plugin (Simulating Rollup/Vite instantiation)
    const rawPlugin = inlinePlugin.rollup()
    const plugin = Array.isArray(rawPlugin) ? rawPlugin[0] : rawPlugin

    // Mock the Rollup context so 'this.resolve' works inside your transform
    const mockContext = {
      resolve: async (source: string) => {
        if (source === './math.ts') return { id: mathPath }
        return null
      },
    }

    // 3. Pass 1: Initial Build
    const result1 = await (plugin.transform as any).call(mockContext, mainCode, mainPath)

    // The inliner should have injected the addition (+) operator
    expect(result1.code).toContain('+')
    expect(result1.code).not.toContain('*')

    // 4. The Developer Modifies the File (Simulating a save)
    const updatedMathCode = `
      // @__INLINE__
      export const mathOp = (a: number, b: number) => a * b; // Changed to multiplication
    `
    fs.writeFileSync(mathPath, updatedMathCode, 'utf-8')

    // 5. Pass 2: Re-transform WITHOUT watchChange
    // Because discoveryCache holds the old promise, it should NOT read the new file
    const resultCached = await (plugin.transform as any).call(mockContext, mainCode, mainPath)
    expect(resultCached.code).toContain('+') // Still uses the old cached blueprint
    expect(resultCached.code).not.toContain('*')

    // 6. Trigger watchChange
    // We append a query string (?t=123) to explicitly test your `id.split('?')[0]` logic
    if (plugin.watchChange) {
      (plugin.watchChange as any).call(mockContext, mathPath + '?t=12345', { event: 'update' })
    }

    // 7. Pass 3: Re-transform AFTER watchChange
    // The cache is cleared, so it must read the disk and find the multiplication blueprint
    const resultCleared = await (plugin.transform as any).call(mockContext, mainCode, mainPath)

    expect(resultCleared.code).toContain('*') // Successfully updated!
    expect(resultCleared.code).not.toContain('+')
  })
})