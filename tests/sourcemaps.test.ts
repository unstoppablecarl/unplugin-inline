import { build } from 'esbuild'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'url'
import { esbuildPlugin } from '../src'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, 'fixtures')

/**
 * Basic VLQ decoder for source map testing
 */
function decodeVLQ(str: string): number[] {
  const charToInteger: Record<string, number> = {}
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((char, i) => {
    charToInteger[char] = i
  })

  const results: number[] = []
  let shift = 0
  let value = 0

  for (let i = 0; i < str.length; i++) {
    let integer = charToInteger[str[i]]
    const hasNext = integer & 32
    integer &= 31
    value += integer << shift

    if (hasNext) {
      shift += 5
    } else {
      const shouldNegate = value & 1
      value >>= 1
      results.push(shouldNegate ? -value : value)
      value = 0
      shift = 0
    }
  }
  return results
}

describe('Source Maps', () => {
  it('should generate correct mappings for inlined code', async () => {
    const fixturePath = path.join(fixturesDir, 'sourcemap-test.ts')
    
    const result = await build({
      entryPoints: [fixturePath],
      bundle: false,
      write: false,
      outfile: 'out.js',
      sourcemap: true,
      plugins: [
        esbuildPlugin({
          autoConvertInlineToMacro: true,
        }),
      ],
      format: 'esm',
    })

    const jsFile = result.outputFiles.find(f => f.path.endsWith('.js'))
    const mapFile = result.outputFiles.find(f => f.path.endsWith('.js.map'))

    expect(jsFile, 'JS output should exist').toBeDefined()
    expect(mapFile, 'Source map should exist').toBeDefined()

    const jsCode = jsFile!.text
    const map = JSON.parse(mapFile!.text)
    
    // 1. Verify sources content is present
    expect(map.sourcesContent).toBeDefined()
    expect(map.sourcesContent[0]).toContain('export const result = add(10, 20)')

    // 2. Find the line containing the inlined code in the output
    const lines = jsCode.split('\n')
    const inlinedLineIndex = lines.findIndex(l => l.includes('const result = 10 + 20'))
    expect(inlinedLineIndex).toBeGreaterThan(-1)

    // 3. Inspect mappings for that line
    const mappingLines = map.mappings.split(';')
    let foundMapping = false

    // To handle relative offsets correctly, we must track originalLine across ALL previous lines and segments
    let currentOriginalLine = 0
    
    for (let i = 0; i <= inlinedLineIndex; i++) {
      const currentLineMappings = mappingLines[i].split(',')
      for (const segment of currentLineMappings) {
        if (!segment) continue
        const decoded = decodeVLQ(segment)
        if (decoded.length >= 4) {
          currentOriginalLine += decoded[2]
          if (i === inlinedLineIndex && currentOriginalLine === 5) {
            foundMapping = true
          }
        }
      }
    }

    expect(foundMapping, `Should find a mapping back to line 6 (index 5) of the original file for output line ${inlinedLineIndex + 1}`).toBe(true)
  })
})
