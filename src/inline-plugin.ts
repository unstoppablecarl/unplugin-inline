import _generate from '@babel/generator'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import fs from 'node:fs'
import path from 'node:path'
import { createUnplugin } from 'unplugin'
import type { FileResolver, InlinePluginOptions, ResolvedImport } from './_types'
import { FILE_EXTENSIONS, STANDARD_GLOBALS } from './defaults'
import { normalizePath } from './lib/_helpers'
import { makeErrorManager } from './lib/ErrorManager'
import { applyInlining, verifyNoLeakedReferences } from './lib/executeInlining'
import { findInlineCandidates } from './lib/findInlineCandidates'
import { flattenInlinedFunctions } from './lib/flattenInlinedFunctions'
import { makeInlineRegistry } from './lib/InlineRegistry'
import { validateFunctionForInlining } from './lib/validateFunctionForInlining'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse
const generate = ((_generate as any).default || _generate) as typeof _generate

const DEBUG = process.env.DEBUG_UNPLUGIN_INLINE === 'true'

export const inlinePlugin = createUnplugin((options?: Partial<InlinePluginOptions>) => {
  const opts = {
    inlineIdentifier: '@__INLINE__',
    inlineMacroIdentifier: '@__INLINE_MACRO__',
    autoConvertInlineToMacro: true,
    allowedGlobals: STANDARD_GLOBALS,
    fileExtensions: FILE_EXTENSIONS,
    variableNamePrefix: '_',
    ...options ?? {},
  }

  const inlineRegistry = makeInlineRegistry()
  const discoveryCache = new Map<string, Promise<{ candidatesInFile: any[], importMap: Map<string, ResolvedImport> }>>()

  return {
    name: 'unplugin-inline',
    enforce: 'pre',
    transformInclude(id) {
      return opts.fileExtensions.some(ext => id.endsWith(ext))
    },
    watchChange(id) {
      const cleanId = id.split('?')[0]
      const p = normalizePath(cleanId)
      discoveryCache.delete(p)
      inlineRegistry.clearFile(p)
    },
    async transform(this: any, code: string, id: string) {
      const cleanId = id.split('?')[0]
      const normId = normalizePath(cleanId)
      const errorManager = makeErrorManager(cleanId)

      // Always clear the current file from the discovery cache to ensure 
      // we use the latest code/AST provided by the transform hook.
      discoveryCache.delete(normId)

      if (DEBUG) console.log(`[unplugin-inline] Transform: ${normId}`)

      const plugins: any[] = ['typescript', 'decorators-legacy']
      if (normId.endsWith('.tsx') || normId.endsWith('.jsx')) plugins.push('jsx')

      const ast = parse(code, { sourceType: 'module', plugins, attachComment: true })

      const getOrDiscoverFile = (targetId: string, targetAst?: t.File, stack = new Set<string>()): Promise<{
        candidatesInFile: any[],
        importMap: Map<string, ResolvedImport>
      }> => {
        const normTarget = normalizePath(targetId)

        // Circularity break
        if (stack.has(normTarget)) {
          return Promise.resolve({ candidatesInFile: [], importMap: new Map() })
        }

        // Atomic check
        const cached = discoveryCache.get(normTarget)
        if (cached) return cached

        const run = async () => {
          const isCurrentFile = normTarget === normId
          const workingAst = (isCurrentFile && targetAst) ? targetAst : parse(await fs.promises.readFile(normTarget, 'utf-8'), {
            sourceType: 'module',
            plugins,
            attachComment: true,
          })
          const errMgr = makeErrorManager(normTarget)
          const nextStack = new Set(stack)
          nextStack.add(normTarget)

          const result = await findInlineCandidates(
            normTarget, opts, workingAst, resolver, inlineRegistry,
            (p) => getOrDiscoverFile(p, undefined, nextStack).then(() => {
            }),
          )

          for (const candidate of result.candidatesInFile) {
            validateFunctionForInlining(normTarget, opts, candidate, errMgr, result.importMap, inlineRegistry)
          }

          // Check for validation errors (like recursion) BEFORE attempting to flatten/sort.
          // This ensures Test 1 (factorial) reports the correct error message.
          if (errMgr.hasValidationErrors()) {
            throw errMgr.reportValidationErrors()
          }

          flattenInlinedFunctions(normTarget, opts, result.candidatesInFile, inlineRegistry, errMgr, result.importMap)

          if (errMgr.hasValidationErrors()) {
            throw errMgr.reportValidationErrors()
          }

          return result
        }

        const task = run()
        discoveryCache.set(normTarget, task)
        return task
      }

      let resolver: FileResolver
      if (typeof this.resolve === 'function') {
        resolver = async (source: string, importer: string) => {
          const resolved = await this.resolve(source, importer)
          return resolved ? resolved.id.split('?')[0] : null
        }
      } else {
        resolver = makeFallbackResolver(opts.fileExtensions)
      }

      const { importMap } = await getOrDiscoverFile(normId, ast)

      const inlinedCount = applyInlining(normId, opts, ast, importMap, errorManager, inlineRegistry)
      verifyNoLeakedReferences(normId, ast, importMap, inlineRegistry, errorManager)
      const removedCount = removeInlinedFunctions(ast, opts)

      traverse.cache.clear()
      cleanupUnusedImports(ast)

      const { code: generatedCode, map } = generate(ast, {
        sourceMaps: true,
        retainLines: false,
        compact: false,
      })

      if (DEBUG) {
        if (inlinedCount > 0) console.log(`[unplugin-inline] Inlined ${inlinedCount} calls in ${normId}`)
        if (removedCount > 0) console.log(`[unplugin-inline] Removed ${removedCount} inlinable definitions from ${normId}`)
      }

      return {
        code: generatedCode,
        map,
      }
    },
  }
})

export function removeInlinedFunctions(ast: t.File, opts: any): number {
  let removedCount = 0
  const isMarked = (comments: readonly t.Comment[] | null | undefined) =>
    comments?.some(c =>
      c.value.includes(opts.inlineIdentifier) ||
      c.value.includes(opts.inlineMacroIdentifier),
    )

  traverse(ast, {
    FunctionDeclaration(path) {
      const parent = path.parentPath
      const isExported = parent.isExportNamedDeclaration()
      const comments = [
        ...(path.node.leadingComments || []),
        ...(isExported ? (parent.node as any).leadingComments || [] : []),
      ]

      if (isMarked(comments)) {
        if (DEBUG) console.log(`[unplugin-inline] Marked FunctionDeclaration for removal: ${path.node.id?.name || 'anonymous'}`)

        path.node.leadingComments = null
        if (isExported) (parent.node as any).leadingComments = null

        if (isExported) {
          parent.remove()
        } else {
          path.remove()
        }
        removedCount++
      }
    },
    VariableDeclarator(path) {
      const parentDecl = path.parentPath
      if (!parentDecl.isVariableDeclaration()) return

      const grandParent = parentDecl.parentPath
      const isExported = grandParent.isExportNamedDeclaration()
      const comments = [
        ...(parentDecl.node.leadingComments || []),
        ...(isExported ? (grandParent.node as any).leadingComments || [] : []),
      ]

      if (isMarked(comments)) {
        if (DEBUG) console.log(`[unplugin-inline] Marked VariableDeclarator for removal: ${(path.node.id as any)?.name || 'anonymous'}`)

        parentDecl.node.leadingComments = null
        if (isExported) (grandParent.node as any).leadingComments = null

        if (parentDecl.node.declarations.length === 1 && (isExported || grandParent.isExportDefaultDeclaration())) {
          grandParent.remove()
        } else {
          path.remove()
        }
        removedCount++
      }
    },
  })
  return removedCount
}

export function makeFallbackResolver(extensions: string[]): FileResolver {
  return async (source: string, importer: string) => {
    if (source.startsWith('.')) {
      const importerDir = path.dirname(importer)
      const absolutePath = path.resolve(importerDir, source)
      for (const ext of extensions) {
        if (fs.existsSync(absolutePath + ext)) return absolutePath + ext
      }
      if (fs.existsSync(absolutePath)) {
        const stat = fs.statSync(absolutePath)
        if (stat.isDirectory()) {
          for (const ext of extensions) {
            const indexPath = path.join(absolutePath, 'index' + ext)
            if (fs.existsSync(indexPath)) return indexPath
          }
        }
        return absolutePath
      }
    }
    return null
  }
}

export function cleanupUnusedImports(ast: t.File) {
  traverse(ast, {
    ImportDeclaration(path) {
      path.scope.crawl()

      if (path.node.specifiers.length === 0) return
      const specifiers = path.get('specifiers')
      specifiers.forEach(specifierPath => {
        const localName = specifierPath.node.local.name
        const binding = path.scope.getBinding(localName)
        if (binding && !binding.referenced) {
          specifierPath.remove()
        }
      })
      if (path.node.specifiers.length === 0) {
        path.remove()
      }
    },
  })
}
