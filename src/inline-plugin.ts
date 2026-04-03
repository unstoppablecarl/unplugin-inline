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
import { ERROR_PREFIX, type ErrorManager, makeErrorManager } from './lib/ErrorManager'
import { executeInlining } from './lib/executeInlining'
import { findInlineCandidates } from './lib/findInlineCandidates'
import { flattenInlinedFunctions } from './lib/flattenInlinedFunctions'
import { type InlineRegistry, makeInlineRegistry } from './lib/InlineRegistry'
import { isUsedInShortCircuit, validateFunctionForInlining } from './lib/validateFunctionForInlining'

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

  if (!(typeof opts.variableNamePrefix === 'string') || opts.variableNamePrefix === '') {
    throw new Error(`${ERROR_PREFIX} opts.variableNamePrefix is required`)
  }

  const inlineRegistry = makeInlineRegistry()
  const discoveryCache = new Map<string, Promise<any>>()

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

      if (DEBUG) console.log(`[unplugin-inline] Transform starting: ${normId}`)

      let resolver: FileResolver
      if (typeof this.resolve === 'function') {
        resolver = async (source: string, importer: string) => {
          const resolved = await this.resolve(source, importer)
          return resolved ? resolved.id.split('?')[0] : null
        }
      } else {
        resolver = makeFallbackResolver(opts.fileExtensions)
      }

      /**
       * Recursively discovers inlinable functions in dependencies.
       * Breaks circularity by returning existing promises from the cache.
       */
      const greedyProcessFile = async (targetPath: string): Promise<void> => {
        const normTarget = normalizePath(targetPath)
        
        const cached = discoveryCache.get(normTarget)
        if (cached) {
          return cached
        }

        const runDiscovery = async () => {
          if (DEBUG) console.log(`[unplugin-inline] Greedily discovering: ${normTarget}`)
          try {
            const fileCode = await fs.promises.readFile(normTarget, 'utf-8')
            const fileAst = parse(fileCode, { sourceType: 'module', plugins: ['typescript'] })
            const errMgr = makeErrorManager(normTarget)

            // findInlineCandidates will call greedyProcessFile recursively
            const { candidatesInFile, importMap } = await findInlineCandidates(
              normTarget, opts, fileAst, resolver, inlineRegistry, greedyProcessFile,
            )

            for (const candidate of candidatesInFile) {
              validateFunctionForInlining(normTarget, opts, candidate, errMgr, importMap, inlineRegistry)
            }
            flattenInlinedFunctions(normTarget, opts, candidatesInFile, inlineRegistry, errMgr)
            if (errMgr.hasValidationErrors()) {
              throw errMgr.reportValidationErrors()
            }
          } catch (e: any) {
            if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return
            throw e
          }
        }

        const task = runDiscovery()
        discoveryCache.set(normTarget, task)
        return task
      }

      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })

      // Logic change: We define the task but DON'T register it in the cache yet.
      // This allows the first findInlineCandidates call to be the "owner" of the 
      // recursive chain. 
      const transformDiscoveryTask = (async () => {
        return await findInlineCandidates(
          normId, opts, ast, resolver, inlineRegistry,
          greedyProcessFile,
        )
      })()

      // To handle circular imports from dependencies BACK to this file:
      if (!discoveryCache.has(normId)) {
        discoveryCache.set(normId, transformDiscoveryTask)
      }

      const { candidatesInFile, importMap } = await transformDiscoveryTask

      // 2. PHASE 2: Validation & Flattening (Local)
      for (const candidate of candidatesInFile) {
        validateFunctionForInlining(id, opts, candidate, errorManager, importMap, inlineRegistry)
        if (errorManager.hasValidationErrors()) {
          inlineRegistry.delete(id, candidate.normalizedName)
          throw errorManager.reportValidationErrors()
        }
      }
      flattenInlinedFunctions(id, opts, candidatesInFile, inlineRegistry, errorManager)

      // 3. PHASE 3: Application
      applyInlining(id, opts, ast, importMap, errorManager, inlineRegistry)

      // 4. PHASE 4: Cleanup
      verifyNoLeakedReferences(id, ast, importMap, inlineRegistry, errorManager)
      removeInlinedFunctions(ast, opts)

      traverse.cache.clear()
      cleanupUnusedImports(ast)

      const { code: generatedCode, map } = generate(ast, { sourceMaps: true }, code)

      if (DEBUG) console.log(`[unplugin-inline] Transform completed: ${normId}`)

      return {
        code: generatedCode,
        map,
      }
    },
  }
})

export function applyInlining(
  id: string,
  opts: any,
  ast: t.File,
  importMap: Map<string, ResolvedImport>,
  errorManager: ErrorManager,
  inlineRegistry: InlineRegistry,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return
      const name = path.node.callee.name

      // Avoid self-recursion
      const parentFunc = path.getFunctionParent()
      let parentName: string | undefined
      if (parentFunc) {
        if (t.isFunctionDeclaration(parentFunc.node)) {
          parentName = parentFunc.node.id?.name
        } else if (parentFunc.parentPath.isVariableDeclarator() && t.isIdentifier(parentFunc.parentPath.node.id)) {
          parentName = parentFunc.parentPath.node.id.name
        }
      }
      if (name === parentName) return

      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)
      if (blueprint) {
        if (isUsedInShortCircuit(path)) {
          throw errorManager.makeValidationError(`Cannot inline function '${name}': used in short-circuiting expression.`, path.node)
        }
        executeInlining(path, opts, blueprint, errorManager)
      }
    },
    Function(p) {
      const node = p.node
      let name: string | undefined
      if (t.isFunctionDeclaration(node) && node.id) {
        name = node.id.name
      } else if (p.parentPath.isVariableDeclarator() && t.isIdentifier(p.parentPath.node.id)) {
        name = p.parentPath.node.id.name
      }
      if (name && inlineRegistry.has(id, name)) {
        p.skip()
      }
    },
  })
}

export function removeInlinedFunctions(ast: t.File, opts: any) {
  const isMarked = (comments: readonly t.Comment[] | null | undefined) =>
    comments?.some(c =>
      c.value.includes(opts.inlineIdentifier) ||
      c.value.includes(opts.inlineMacroIdentifier),
    )

  traverse(ast, {
    FunctionDeclaration(path) {
      if (isMarked(path.node.leadingComments)) {
        if (t.isExportNamedDeclaration(path.parent)) {
          path.parentPath.remove()
        } else {
          path.remove()
        }
      }
    },
    VariableDeclarator(path) {
      const arrow = path.node.init
      if (t.isArrowFunctionExpression(arrow) && t.isIdentifier(path.node.id)) {
        const parentDecl = path.parentPath
        if (!parentDecl.isVariableDeclaration()) return
        if (isMarked(parentDecl.node.leadingComments)) {
          const grandParent = parentDecl.parentPath
          if (parentDecl.node.declarations.length === 1 &&
            (grandParent?.isExportNamedDeclaration() || grandParent?.isExportDefaultDeclaration())) {
            grandParent.remove()
          } else {
            path.remove()
          }
        }
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
  if (inlineRegistry.has(currentFile, name)) {
    return inlineRegistry.get(currentFile, name)
  }
  const imported = importMap.get(name)
  if (imported) {
    return inlineRegistry.get(imported.sourcePath, imported.originalName)
  }
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

export function verifyNoLeakedReferences(
  id: string,
  ast: t.File,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return
      const name = path.node.callee.name
      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)
      if (blueprint) {
        // Log or throw if needed
      }
    },
  })
}

export function cleanupUnusedImports(ast: t.File) {
  traverse(ast, {
    ImportDeclaration(path) {
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
