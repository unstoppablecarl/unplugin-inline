import * as esbuild from 'esbuild'
import { bench, group, run, summary } from 'mitata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esbuildPlugin } from '../src'
import type { BenchProcess, CaseCallback, FilePathString } from './_types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, './fixtures')

const randomInt = () => (Math.random() * 255 + 1) | 0

async function runBenchmarkSuite() {
  const cases: Record<FilePathString, any[]> = {
    [fixturesDir + '/deep-nesting.ts']: [randomInt],
    [fixturesDir + '/large-transform.ts']: [randomInt],
    [fixturesDir + '/branch-logic.ts']: [randomInt, randomInt, randomInt],
  }

  await eachCase(cases, ({ file, standard, inlined, args }) => {
    // Pre-generate a pool of varied inputs to defeat V8 constant folding.
    // Cycling through 1024 values (varied by +i) forces actual computation.
    // Pool size is a power of 2 so the index wrap is a cheap bitmask, not %.
    const POOL_SIZE = 1024

    const inputPool: any[][] = Array.from({ length: POOL_SIZE }, () =>
      args.map(gen => gen()),
    )

    group(`Runtime: ${file}`, () => {
      summary(() => {
        bench('Standard', () => {
          // Return the result so mitata can detect if the engine has eliminated
          // the computation as dead code (a no-return call with no side effects
          // can be proven unnecessary and dropped by the JIT).
          const i = (Math.random() * POOL_SIZE) | 0
          return standard.runtime(inputPool[i])
        }).baseline()

        bench('Inlined', () => {
          const i = (Math.random() * POOL_SIZE) | 0
          return inlined.runtime(inputPool[i])
        })
      })
    })
  })

  await run()
}

let evaluationCacheId = 0

export async function eachCase(
  cases: Record<FilePathString, any[]>,
  cb: CaseCallback,
): Promise<void> {
  for (const [filePath, args] of Object.entries(cases)) {
    const file = path.basename(filePath)

    // Build both variants. These run once during setup, not in the timed loop.
    const [stdResult, inlineResult] = await Promise.all([
      esbuild.build({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        format: 'esm',
      }),
      esbuild.build({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        format: 'esm',
        plugins: [esbuildPlugin()],
      }),
    ])

    const stdCode = stdResult.outputFiles[0].text
    const inlineCode = inlineResult.outputFiles[0].text

    // Base64 data URLs are the simplest way to import dynamic ESM without
    // writing temp files. The tradeoff is a slightly longer URL parse on first
    // import, which only happens once here in setup — not in the timed loop.
    const stdDataUrl = `data:text/javascript;base64,${Buffer.from(stdCode).toString('base64')}`
    const inlineDataUrl = `data:text/javascript;base64,${Buffer.from(inlineCode).toString('base64')}`

    const [stdModule, inlineModule] = await Promise.all([
      import(stdDataUrl),
      import(inlineDataUrl),
    ])

    // Validate both variants agree on a representative input before benchmarking.
    const sampleArgs = args.map(gen => gen())
    const stdVal = stdModule.run(...sampleArgs)
    const inlineVal = inlineModule.run(...sampleArgs)

    if (!Object.is(stdVal, inlineVal)) {
      throw new Error(
        `Logic mismatch in ${file}!\n` +
        `  Standard: ${stdVal}\n` +
        `  Inlined:  ${inlineVal}`,
      )
    }

    const standard: BenchProcess = {
      evaluation: async () => {
        // Fragment suffix forces a fresh cache key each call so Node re-evaluates
        // the module. Without this, the second call returns the cached module
        // instantly and measures nothing.
        await import(`${stdDataUrl}#${evaluationCacheId++}`)
      },
      runtime: (callArgs: any[]) => stdModule.run(...callArgs),
    }

    const inlined: BenchProcess = {
      evaluation: async () => {
        await import(`${inlineDataUrl}#${evaluationCacheId++}`)
      },
      runtime: (callArgs: any[]) => inlineModule.run(...callArgs),
    }

    cb({ file, standard, inlined, args })
  }
}

runBenchmarkSuite().catch(console.error)