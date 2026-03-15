import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { Bench } from 'tinybench'
import { fileURLToPath } from 'url'
import { esbuildPlugin } from '../src'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../tests/fixtures')

export function getBenchFiles(): string [] {

  const allFiles = fs.readdirSync(fixturesDir)
  return allFiles.filter(f => {
    const isTarget = f.endsWith('.ts')
    const isHelper = f.startsWith('_')
    const isBailout = f.includes('bailout')
    return isTarget && !isHelper && !isBailout
  }).map(f => path.join(fixturesDir, f))
}

async function runBenchmarkSuite() {
  const files = getBenchFiles()
  console.log(`🚀 Starting Benchmark Suite: ${files.length} fixtures found\n`)

  for (const filePath of files) {
    const file = path.basename(filePath)

    // 1. Get the "Standard" code (just bundle without our plugin)
    const stdResult = await esbuild.build({
      entryPoints: [filePath],
      bundle: true,
      write: false,
      format: 'esm',
    })

    // 2. Get the "Inlined" code (bundle WITH our plugin)
    const inlineResult = await esbuild.build({
      entryPoints: [filePath],
      bundle: true,
      write: false,
      format: 'esm',
      plugins: [esbuildPlugin()],
    })

    const stdCode = stdResult.outputFiles[0].text
    const inlineCode = inlineResult.outputFiles[0].text

    // 3. Setup tinybench for this specific fixture
    const bench = new Bench({ time: 200 })

    // We use dynamic imports/eval to run the bundled code strings
    // Note: This assumes the fixtures export a 'result' or a main logic entry
    const stdModule = await import(`data:text/javascript;base64,${Buffer.from(stdCode).toString('base64')}`)
    const inlineModule = await import(`data:text/javascript;base64,${Buffer.from(inlineCode).toString('base64')}`)

    bench
      .add(`${file} [Standard]`, () => {
        // Just access the export to trigger evaluation logic if it's top-level
        return stdModule.result
      })
      .add(`${file} [Inlined]`, () => {
        return inlineModule.result
      })

    await bench.run()

    console.log(`--- Results for: ${file} ---`)
    console.table(bench.table())
    console.log('\n')
  }
}

runBenchmarkSuite().catch(console.error)