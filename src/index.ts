import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { createUnplugin } from 'unplugin'
import type { FileResolver, InlinePluginOptions, ResolvedImport } from './_types'
import { makeErrorManager } from './ErrorManager'
import { type InlineRegistry, makeInlineRegistry } from './InlineRegistry'
import { executeInlining } from './lib/executeInlining'
import { findInlineCandidates } from './lib/findInlineCandidates'
import { flattenInlinedFunctions } from './lib/flattenInlinedFunctions'
import { validateFunctionForInlining } from './lib/validateFunctionForInlining'
import { STANDARD_GLOBALS } from './standard-globals'

interface TransformContext {
  resolve: (source: string, importer: string) => Promise<{ id: string } | null>
}

export const inlinePlugin = createUnplugin((options: Partial<InlinePluginOptions> = {}) => {
  const opts = {
    inlineIdentifier: '@__INLINE__',
    allowedGlobals: STANDARD_GLOBALS,
    variableNamePrefix: '',
    ...options,
  }

  const inlineRegistry = makeInlineRegistry()

  return {
    name: 'unplugin-inline',
    enforce: 'pre',
    transformInclude(id) {
      return id.endsWith('.ts') || id.endsWith('.js')
    },
    async transform(this: any, code: string, id: string) {
      const cleanId = id.split('?')[0]
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })
      const errorManager = makeErrorManager(cleanId)

      const resolver: FileResolver = async (source: string, importer: string) => {
        const resolved = await (this as any).resolve(source, importer)
        return resolved ? resolved.id.split('?')[0] : null
      }

      // 1. PHASE 1: Discovery
      const {
        candidatesInFile,
        importMap,
      } = await findInlineCandidates(id, opts, ast, resolver, inlineRegistry)

      // validate candidates
      for (const path of candidatesInFile) {
        const node = path.node
        const funcName = node.id!.name
        const isValid = validateFunctionForInlining(
          id,
          opts,
          path,
          errorManager,
          importMap,
          inlineRegistry,
        )
        if (!isValid) {
          inlineRegistry.delete(id, funcName)
          throw errorManager.makeValidationError()
        }

        // set actual candidate blueprint
        inlineRegistry.set(id, funcName, {
          params: node.params as t.Identifier[],
          body: t.cloneNode(node.body),
        })
      }

      flattenInlinedFunctions(id, opts, candidatesInFile, inlineRegistry)

      applyInlining(id, opts, ast, importMap, inlineRegistry)

      removeInlinedFunctions(ast, opts.inlineIdentifier)

      // 6. Generate final code
      const { code: generatedCode, map } = generate(ast, { sourceMaps: true }, code)

      return {
        code: generatedCode,
        map,
      }
    },
  }
})

export function applyInlining(
  id: string,
  opts: InlinePluginOptions,
  ast: t.File,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return

      const name = path.node.callee.name
      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)

      if (blueprint) {
        executeInlining(path, opts, blueprint)
      }
    },
    // We skip nested functions because we only inline into the main flow
    // and those nested functions will be processed if they are called.
    Function(p) {
      p.skip()
    },
  })
}

export function removeInlinedFunctions(ast: t.File, inlineIdentifier: string) {
  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node
      const isMarked = node.leadingComments?.some(c => c.value.includes(inlineIdentifier))

      // Safety: Only remove if it is NOT exported.
      // If exported, other files might still need to import the actual function.
      if (isMarked && !t.isExportNamedDeclaration(path.parent)) {
        path.remove()
      }
    },
  })
}

function resolveBlueprint(
  name: string,
  currentFile: string,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
) {
  // 1. Check Local Registry first
  if (inlineRegistry.has(currentFile, name)) {
    return inlineRegistry.get(currentFile, name)
  }

  // 2. Check Import Map for cross-file registry entries
  const imported = importMap.get(name)
  if (imported) {
    return inlineRegistry.get(imported.sourcePath, imported.originalName)
  }
}

export const vitePlugin = inlinePlugin.vite
export const rollupPlugin = inlinePlugin.rollup
export const esbuildPlugin = inlinePlugin.esbuild
export const webpackPlugin = inlinePlugin.webpack
export default inlinePlugin