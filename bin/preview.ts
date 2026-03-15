import * as esbuild from 'esbuild'
import path from 'node:path'
import { esbuildPlugin } from '../src'

function printUsage(): void {
  console.log(`
Usage:
  tsx preview.ts <file>

Examples:
  tsx preview.ts ./benchmark/fixtures/branch-logic.ts
  tsx preview.ts ./benchmark/fixtures/large-transform.ts
  `.trim())
}

const arg = process.argv[2]

if (!arg || arg === '--help' || arg === '-h') {
  printUsage()
  process.exit(arg ? 0 : 1)
}

const targetFile = path.resolve(process.cwd(), arg)

const preview = async () => {
  const result = await esbuild.build({
    entryPoints: [
      targetFile,
    ],
    write: false,
    bundle: true,
    format: 'esm',
    plugins: [
      esbuildPlugin(),
    ],
  })

  const output = result.outputFiles[0]

  console.log('--- ESBUILD OUTPUT ---')
  console.log(output.text)
}

preview()