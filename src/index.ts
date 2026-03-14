import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { createUnplugin } from 'unplugin'
import { applyInlineFunctions } from './applyInlineFunctions'
import { makeErrorManager } from './ErrorManager'
import { findAndValidate } from './findAndValidate'
import { makeInlineRegistry } from './InlineRegistry'

export interface InlinePluginOptions {
  inlineIdentifier?: string
}

interface TransformContext {
  resolve: (source: string, importer: string) => Promise<{ id: string } | null>
}

// src/index.ts
export const inlinePlugin = createUnplugin((options: InlinePluginOptions = {}) => {
  const inlineIdentifier = options.inlineIdentifier || '@__INLINE__'
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

      const resolver = async (source: string, importer: string) => {
        const resolved = await (this as any).resolve(source, importer)
        return resolved ? resolved.id.split('?')[0] : null
      }

      // 1. Discovery (Keeps functions in AST but populates registry)
      findAndValidate(cleanId, inlineIdentifier, ast, inlineRegistry, errorManager)

      // 2. Transformation (Bindings are still alive, so resolution works!)
      await applyInlineFunctions(cleanId, inlineIdentifier, ast, inlineRegistry, errorManager, resolver)

      // 3. Cleanup: Remove functions that were marked for inlining and aren't exported
      traverse(ast, {
        FunctionDeclaration(path) {
          const { node } = path;
          const isMarked = node.leadingComments?.some(c => c.value.includes(inlineIdentifier)) ||
            (t.isExportNamedDeclaration(path.parent) &&
              path.parent.leadingComments?.some(c => c.value.includes(inlineIdentifier)));

          if (isMarked && !t.isExportNamedDeclaration(path.parent)) {
            path.remove();
          }
        }
      });

      const validationError = errorManager.makeValidationError()
      if (validationError) {
        throw validationError
      }

      const { code: generatedCode, map } = generate(ast, { sourceMaps: true }, code)

      return {
        code: generatedCode,
        map,
      }
    },
  }
})

export const vitePlugin = inlinePlugin.vite
export const rollupPlugin = inlinePlugin.rollup
export const esbuildPlugin = inlinePlugin.esbuild
export const webpackPlugin = inlinePlugin.webpack
export default inlinePlugin