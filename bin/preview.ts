import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esbuildPlugin } from '../src'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const targetFile = path.resolve(__dirname, '../tests/fixtures/default-params.ts')

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