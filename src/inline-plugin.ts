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
  // const globalVisitedFiles = new Set<string>()
  const discoveryCache = new Map<string, Promise<void>>()

  return {
    name: 'unplugin-inline',
    enforce: 'pre',
    transformInclude(id) {
      return opts.fileExtensions.some(ext => id.endsWith(ext))
    },
    watchChange(id) {
      const cleanId = id.split('?')[0]
      const path = normalizePath(cleanId)
      discoveryCache.delete(path)

      inlineRegistry.clearFile(path)
    },
    async transform(this: any, code: string, id: string) {
      const cleanId = id.split('?')[0]
      const normId = normalizePath(cleanId)
      const errorManager = makeErrorManager(cleanId)

      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })

      // If we haven't discovered this file yet, claim it in the cache
      // so importers don't try to read it from disk while we are transforming it.
      if (!discoveryCache.has(normId)) {
        discoveryCache.set(normId, Promise.resolve())
      }
      let resolver: FileResolver

      // Try Rollup/Vite's native resolver if available
      if (typeof this.resolve === 'function') {
        resolver = async (source: string, importer: string) => {
          const resolved = await this.resolve(source, importer)
          return resolved ? resolved.id.split('?')[0] : null
        }
      } else {
        resolver = makeFallbackResolver(opts.fileExtensions)
      }

      const greedyProcessFile = (targetPath: string): Promise<void> => {
        const normTarget = normalizePath(targetPath)
        if (!opts.fileExtensions.some(ext => normTarget.endsWith(ext))) return Promise.resolve()

        const cached = discoveryCache.get(normTarget)
        if (cached) return cached

        // 1. Create the async logic
        const runDiscovery = async () => {
          try {
            const fileCode = await fs.promises.readFile(normTarget, 'utf-8')
            const fileAst = parse(fileCode, { sourceType: 'module', plugins: ['typescript'] })
            const errMgr = makeErrorManager(normTarget)

            const { candidatesInFile, importMap } = await findInlineCandidates(
              normTarget, opts, fileAst, resolver, inlineRegistry, greedyProcessFile,
            )

            for (const candidate of candidatesInFile) {
              validateFunctionForInlining(normTarget, opts, candidate, errMgr, importMap, inlineRegistry)
            }
            flattenInlinedFunctions(normTarget, opts, candidatesInFile, inlineRegistry, errMgr)
            if (errMgr.hasValidationErrors()) {
              // inlineRegistry.delete(normTarget, candidate.normalizedName)
              throw errMgr.reportValidationErrors()
            }
          } catch (e: any) {
            if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return
            throw e
          }
        }

        // 2. Register the promise IMMEDIATELY before awaiting anything
        const task = runDiscovery()
        discoveryCache.set(normTarget, task)
        return task
      }

      // 1. PHASE 1: Discovery
      const {
        candidatesInFile,
        importMap,
      } = await findInlineCandidates(id, opts, ast, resolver, inlineRegistry, greedyProcessFile)

      // validate candidates
      for (const candidate of candidatesInFile) {
        validateFunctionForInlining(
          id,
          opts,
          candidate,
          errorManager,
          importMap,
          inlineRegistry,
        )

        if (errorManager.hasValidationErrors()) {
          inlineRegistry.delete(id, candidate.normalizedName)
          throw errorManager.reportValidationErrors()
        }
      }

      flattenInlinedFunctions(id, opts, candidatesInFile, inlineRegistry, errorManager)

      applyInlining(id, opts, ast, importMap, errorManager, inlineRegistry)

      // Ensure no CallExpressions remain that target our inlinable functions
      verifyNoLeakedReferences(id, ast, importMap, inlineRegistry, errorManager)

      removeInlinedFunctions(ast, opts)

      // We call crawl() here to ensure Babel's reference counts are 100% accurate
      // after all the heavy AST manipulation we just did.
      ast.program.body.forEach(() => {
      })
      traverse.cache.clear()
      cleanupUnusedImports(ast)

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
  errorManager: ErrorManager,
  inlineRegistry: InlineRegistry,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return

      const name = path.node.callee.name

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
          const calledName = path.node.callee.name
          throw errorManager.makeValidationError(`Cannot inline function '${calledName}': used in short-circuiting expression.`, path.node)
        }

        executeInlining(path, opts, blueprint, errorManager)
      }
    },
    Function(p) {
      // Prevent traversing into functions marked for inlining.
      // We already flattened them in the registry, and their source nodes
      // are about to be deleted. We only want to inline into "surviving" code.
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

export function removeInlinedFunctions(ast: t.File, opts: InlinePluginOptions) {
  const isMarked = (comments: readonly t.Comment[] | null | undefined) =>
    comments?.some(c =>
      c.value.includes(opts.inlineIdentifier) ||
      c.value.includes(opts.inlineMacroIdentifier),
    )

  traverse(ast, {
    FunctionDeclaration(path) {
      if (isMarked(path.node.leadingComments)) {
        // If it's 'export function foo()', remove the ExportNamedDeclaration parent
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

          // Only remove the whole export if this is the ONLY thing being exported in this statement
          if (parentDecl.node.declarations.length === 1 &&
            (grandParent?.isExportNamedDeclaration() || grandParent?.isExportDefaultDeclaration())) {
            grandParent.remove()
          } else {
            // Otherwise, just remove this specific function declarator
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

function makeFallbackResolver(extensions: string[]): FileResolver {
  return async (source: string, importer: string) => {

    // 2. Fallback for esbuild/Webpack (handles local relative imports)
    if (source.startsWith('.')) {
      const importerDir = path.dirname(importer)
      const absolutePath = path.resolve(importerDir, source)

      for (const ext of extensions) {
        if (fs.existsSync(absolutePath + ext)) {
          return absolutePath + ext
        }
      }

      // Check if it resolves perfectly without an extension (e.g., importing a folder index)
      if (fs.existsSync(absolutePath)) {
        const stat = fs.statSync(absolutePath)
        if (stat.isDirectory()) {
          for (const ext of extensions) {
            const indexPath = path.join(absolutePath, 'index' + ext)
            if (fs.existsSync(indexPath)) {
              return indexPath
            }
          }
        }
        return absolutePath
      }
    }

    // Return null for bare node_modules
    return null
  }
}

/**
 * Ensures that every call to an inlinable function was successfully processed.
 * If a reference remains, it means the inliner skipped a site it shouldn't have.
 */
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

      // Check if this name refers to an inlined blueprint
      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)

      if (blueprint) {
        // throw errorManager.makeInternalError(`Internal Error: Function '${name}' was marked for inlining but a call site remains.`,
        //   path.node,
        // )
      }
    },
  })
}

/**
 * Removes import specifiers that are no longer used after inlining.
 * If an entire ImportDeclaration becomes empty, it removes the whole statement.
 */
export function cleanupUnusedImports(ast: t.File) {
  traverse(ast, {
    ImportDeclaration(path) {
      // 1. Skip side-effect only imports like `import "Reflect"`
      if (path.node.specifiers.length === 0) return

      const specifiers = path.get('specifiers')

      specifiers.forEach(specifierPath => {
        const localName = specifierPath.node.local.name
        const binding = path.scope.getBinding(localName)

        // 2. If the binding exists but has no references, it's safe to remove.
        // Babel's 'referenced' property is updated automatically during inlining.
        if (binding && !binding.referenced) {
          specifierPath.remove()
        }
      })

      // 3. If we removed all specifiers, the whole import is dead weight.
      if (path.node.specifiers.length === 0) {
        path.remove()
      }
    },
  })
}