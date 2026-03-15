import _generate from '@babel/generator'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import fs from 'node:fs'
import path from 'node:path'
import { createUnplugin } from 'unplugin'
import type { FileResolver, InlinePluginOptions, ResolvedImport } from './_types'
import { FILE_EXTENSIONS, STANDARD_GLOBALS } from './defaults'
import { type ErrorManager, makeErrorManager } from './lib/ErrorManager'
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
    allowedGlobals: STANDARD_GLOBALS,
    fileExtensions: FILE_EXTENSIONS,
    variableNamePrefix: '',
    ...options ?? {},
  }

  const inlineRegistry = makeInlineRegistry()
  const globalVisitedFiles = new Set<string>()

  return {
    name: 'unplugin-inline',
    enforce: 'pre',
    transformInclude(id) {
      return id.endsWith('.ts') || id.endsWith('.js')
    },
    watchChange(id) {
      const cleanId = id.split('?')[0]
      globalVisitedFiles.delete(cleanId)

      inlineRegistry.clearFile(cleanId)
    },
    async transform(this: any, code: string, id: string) {
      const cleanId = id.split('?')[0]
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })
      const errorManager = makeErrorManager(cleanId)

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

      const greedyProcessFile = async (targetPath: string) => {
        if (globalVisitedFiles.has(targetPath)) return
        globalVisitedFiles.add(targetPath)

        try {
          const fileCode = await fs.promises.readFile(targetPath, 'utf-8')
          const fileAst = parse(fileCode, {
            sourceType: 'module',
            plugins: ['typescript'],
          })
          const errMgr = makeErrorManager(targetPath)

          const {
            candidatesInFile,
            importMap,
          } = await findInlineCandidates(targetPath, opts, fileAst, resolver, inlineRegistry, greedyProcessFile)

          for (const { nodePath, normalizedName } of candidatesInFile) {
            const isValid = validateFunctionForInlining(targetPath, opts, nodePath, errMgr, importMap, inlineRegistry)
            if (!isValid) inlineRegistry.delete(targetPath, normalizedName)
          }

          flattenInlinedFunctions(targetPath, opts, candidatesInFile, inlineRegistry)
        } catch (e) {
          // Ignore unreadable files (e.g. built-in node modules)
        }
      }

      // 1. PHASE 1: Discovery
      const {
        candidatesInFile,
        importMap,
      } = await findInlineCandidates(id, opts, ast, resolver, inlineRegistry, greedyProcessFile)

      // validate candidates
      for (const { nodePath, normalizedName } of candidatesInFile) {
        const isValid = validateFunctionForInlining(
          id,
          opts,
          nodePath,
          errorManager,
          importMap,
          inlineRegistry,
        )

        if (!isValid) {
          inlineRegistry.delete(id, normalizedName)
          throw errorManager.makeValidationError()
        }
      }

      flattenInlinedFunctions(id, opts, candidatesInFile, inlineRegistry)

      applyInlining(id, opts, ast, importMap, errorManager, inlineRegistry)

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
  errorManager: ErrorManager,
  inlineRegistry: InlineRegistry,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return

      const name = path.node.callee.name
      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)

      if (blueprint) {
        if (isUsedInShortCircuit(path)) {
          const calledName = path.node.callee.name
          errorManager.recordError(`Cannot inline function '${calledName}': used in short-circuiting expression.`, path.node)
          throw errorManager.makeValidationError()
        }

        executeInlining(path, opts, blueprint)
      }
    },
    Function(p) {
      // 1. Identify the name of this function
      const node = p.node
      let name: string | undefined

      if (t.isFunctionDeclaration(node) && node.id) {
        name = node.id.name
      } else if (p.parentPath.isVariableDeclarator() && t.isIdentifier(p.parentPath.node.id)) {
        name = p.parentPath.node.id.name
      }

      // 2. ONLY skip if this specific function is in the registry.
      // This prevents re-processing blueprints, but allows inlining into 'run'.
      if (name && inlineRegistry.has(id, name)) {
        p.skip()
      }
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
    VariableDeclarator(path) {
      const { node } = path
      const arrow = node.init

      if (t.isArrowFunctionExpression(arrow) && t.isIdentifier(node.id)) {
        const parentDeclaration = path.parentPath
        const isMarked = parentDeclaration?.node.leadingComments?.some(c => c.value.includes(inlineIdentifier))

        if (isMarked && !t.isExportNamedDeclaration(parentDeclaration.parent)) {
          // Remove just this declarator. If it's `const a = 1, b = () => {}`, 'a' survives.
          path.remove()
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
