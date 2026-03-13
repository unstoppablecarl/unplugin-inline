import type { BuildOptions, BuildResult } from 'esbuild'
import { build } from 'esbuild'
import { rollup } from 'rollup'
import type { InlinePluginOptions } from '../src'
import { esbuildPlugin, rollupPlugin } from '../src'

/**
 * Helper to format code with line numbers for debugging
 */
function formatCode(code: string): string {
  const lines = code.split('\n')
  const mappedLines = lines.map((line, i) => {
    const num = (i + 1).toString()
    const paddedNum = num.padStart(3)

    return `${paddedNum} | ${line}`
  })

  return mappedLines.join('\n')
}

export async function bundleSilent(fixturePath: string, options: InlinePluginOptions = {}) {
  return bundle(fixturePath, options, true)
}

/**
 * Runs esbuild with the inline plugin and returns the transformed code.
 * Used for testing the compilation output.
 */
export async function bundle(fixturePath: string, options: InlinePluginOptions = {}, silent = false) {
  const buildOptions: BuildOptions = {
    entryPoints: [
      fixturePath,
    ],
    bundle: false,
    write: false,
    plugins: [
      esbuildPlugin(options),
    ],
    format: 'esm' as const,
  }

  if (silent) {
    buildOptions.logLevel = 'silent'
  }

  const result = await build(buildOptions)
  return result.outputFiles![0].text
}

export async function bundleAndRunSilent(fixturePath: string, options: InlinePluginOptions = {}) {
  return bundleAndRun(fixturePath, options, true)
}

/**
 * Runs esbuild with the inline plugin, executes the resulting code,
 * and returns the exports and logs.
 * Used for testing the functional behavior of the inlined code.
 */
export async function bundleAndRun(fixturePath: string, options: InlinePluginOptions = {}, silent = false) {
  let result: BuildResult

  try {
    const buildOptions: BuildOptions = {
      entryPoints: [
        fixturePath,
      ],
      bundle: false,
      write: false,
      plugins: [
        esbuildPlugin(options),
      ],
      format: 'cjs' as const,
      platform: 'node' as const,
      target: 'es2020',
    }

    if (silent) {
      buildOptions.logLevel = 'silent'
    }
    result = await build(buildOptions)
  } catch (e) {
    throw e
  }

  const code = result!.outputFiles![0].text

  try {
    const logs: any[] = []

    const moduleObj = {
      exports: {},
    }
    const exportsObj = moduleObj.exports

    const run = new Function(
      'module',
      'exports',
      'console',
      code,
    )

    const consoleMock = {
      log: (msg: any) => {
        logs.push(msg)
      },
    }

    run(moduleObj, exportsObj, consoleMock)

    return {
      code,
      logs,
      exports: moduleObj.exports,
    }
  } catch (error: any) {
    const isError = error instanceof Error
    const errorMessage = isError ? error.message : String(error)
    const stack = isError ? error.stack : ''

    const numberedCode = formatCode(code)
    const fullMessage = `Execution failed: ${errorMessage}\n\n--- Generated Code ---\n${numberedCode}\n----------------------\n\nOriginal Stack:\n${stack}`

    throw new Error(fullMessage)
  }
}

/**
 * Runs Rollup with the inline plugin, executes the resulting code,
 * and returns the exports and logs.
 */
export async function bundleAndRunRollup(fixturePath: string, options: InlinePluginOptions = {}) {
  const pluginInstance = rollupPlugin(options)

  try {
    const bundle = await rollup({
      input: fixturePath,
      plugins: [
        pluginInstance,
      ],
      // Suppress Rollup warnings in tests
      onwarn: () => {
      },
    })

    const { output } = await bundle.generate({
      format: 'cjs',
    })

    const code = output[0].code
    const logs: any[] = []
    const moduleObj = { exports: {} }

    const run = new Function('module', 'exports', 'console', code)
    run(moduleObj, moduleObj.exports, {
      log: (msg: any) => logs.push(msg),
    })

    return {
      code,
      logs,
      exports: moduleObj.exports,
    }
  } catch (error: any) {
    // Re-wrap Rollup errors to match the test assertion expectations
    if (error.message.includes('Validation failed')) {
      throw {
        errors: [{ text: error.message }],
      }
    }
    throw error
  }
}