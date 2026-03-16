import * as esbuild from 'esbuild'
import { bench, group, run, summary } from 'mitata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esbuildPlugin } from '../src'
import type { ArgsGenerator, BenchProcess, CaseCallback, FilePathString } from './_types'
import { randomInt, randomVectorMatrixData } from './fixtures/_helperts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, './fixtures')

async function runBenchmarkSuite() {
  const cases: Record<FilePathString, ArgsGenerator> = {
    [fixturesDir + '/deep-nesting.ts']: () => [randomInt()],
    [fixturesDir + '/large-transform.ts']: () => [randomInt()],
    [fixturesDir + '/branch-logic.ts']: () => [randomInt(), randomInt(), randomInt()],
    [fixturesDir + '/synthetic-large.ts']: () => [randomInt()],
    [fixturesDir + '/vector-matrix.ts']: () => {
      const { vertices, ctx } = randomVectorMatrixData()
      return [vertices, ctx]
    },
  }

  await eachCase(cases, ({ file, standard, inlined, argsGenerator }) => {
    const WARMUP_ITERATIONS = 10_000
    const POOL_SIZE = 1024
    const inputPool: any[][] = Array.from({ length: POOL_SIZE }, () => argsGenerator())

    // 2. Create a shuffled permutation table
    // This makes the access pattern non-linear (unpredictable for JIT)
    // but the actual overhead is just an array lookup.
    const permutation = Array.from({ length: POOL_SIZE }, (_, i) => i)
      .sort(() => Math.random() - 0.5)

    // WARMUP PHASE
    // This primes TurboFan so we measure the "steady state" performance.
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const idx = permutation[i % POOL_SIZE]
      standard.runtime(inputPool[idx])
      inlined.runtime(inputPool[idx])
    }

    let cursorStd = 0
    let cursorInl = 0

    group(`Runtime: ${file}`, () => {
      summary(() => {
        bench('Standard', () => {
          // Use the permutation table to pick an input index
          const idx = permutation[cursorStd++ % POOL_SIZE]
          return standard.runtime(inputPool[idx])
        }).baseline()

        bench('Inlined', () => {
          const idx = permutation[cursorInl++ % POOL_SIZE]
          return inlined.runtime(inputPool[idx])
        })
      })
    })
  })

  await run()
}

let evaluationCacheId = 0

export async function eachCase(
  cases: Record<FilePathString, ArgsGenerator>,
  cb: CaseCallback,
): Promise<void> {
  for (const [filePath, argsGenerator] of Object.entries(cases)) {
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
    const args = argsGenerator()
    const stdVal = stdModule.run(...args)
    const inlineVal = inlineModule.run(...args)

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

    cb({ file, standard, inlined, argsGenerator })
  }
}

runBenchmarkSuite().catch(console.error)