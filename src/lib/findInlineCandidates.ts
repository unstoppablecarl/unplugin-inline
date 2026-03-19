import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import {
  type FileResolver,
  type InlineCandidate,
  InlineCandidateType,
  type InlinePluginOptions,
  type ResolvedImport,
} from '../_types'
import { makeErrorManager } from './ErrorManager'
import { type InlineRegistry } from './InlineRegistry'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse

export async function findInlineCandidates(
  id: string,
  opts: InlinePluginOptions,
  ast: t.File,
  resolver: FileResolver,
  inlineRegistry: InlineRegistry,
  processImport: (path: string) => Promise<void>,
) {
  const importMap = new Map<string, ResolvedImport>()
  const candidatesInFile: InlineCandidate[] = []
  const localCandidateNames = new Set<string>()

  // PRE-RESOLVE IMPORTS (Wait for dependencies to be registered)
  const importPromises = ast.program.body
    .filter((node): node is t.ImportDeclaration => t.isImportDeclaration(node))
    .map(async (node) => {
      const source = node.source.value
      const resolvedPath = await resolver(source, id)

      // If resolver returns null, we can't track this source.
      if (!resolvedPath) return

      // 1. Immediately parse the imported file and extract its blueprints
      await processImport(resolvedPath)

      node.specifiers.forEach(spec => {
        if (t.isImportSpecifier(spec) || t.isImportDefaultSpecifier(spec)) {
          const importedName = t.isImportSpecifier(spec)
            ? (t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value)
            : 'default'

          importMap.set(spec.local.name, {
            sourcePath: resolvedPath,
            originalName: importedName,
          })
        }
      })
    })

  await Promise.all(importPromises)

  // FIRST PASS: Find all local candidates
  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node
      const funcName = node.id?.name ?? 'default'
      const isExported = t.isExportNamedDeclaration(path.parent)
      const exportComments = isExported ? path.parent.leadingComments : undefined

      const type = resolveCandidateType(
        node.leadingComments,
        exportComments,
        opts,
        id,
        node,
      )

      if (type !== InlineCandidateType.NONE) {
        localCandidateNames.add(funcName)
        const body = t.cloneNode(node.body)

        candidatesInFile.push({
          type,
          normalizedName: funcName,
          normalizedBody: body,
          nodePath: path,
          localDependencies: new Set(),
        })
      }
    },
    // Arrow Functions
    VariableDeclarator(path) {
      const node = path.node
      const arrow = node.init

      if (t.isArrowFunctionExpression(arrow) && t.isIdentifier(node.id)) {
        const funcName = node.id.name
        const parentDecl = path.parentPath

        // 1. Defensively check the parent type
        if (!parentDecl.isVariableDeclaration()) return

        const grandParent = parentDecl.parentPath
        const isExported = grandParent?.isExportNamedDeclaration()
        const exportComments = isExported ? grandParent.node.leadingComments : undefined

        const type = resolveCandidateType(
          parentDecl.node.leadingComments,
          exportComments,
          opts,
          id,
          node,
        )

        if (type === InlineCandidateType.NONE) return
        localCandidateNames.add(funcName)
        let body: t.BlockStatement

        if (t.isBlockStatement(arrow.body)) {
          body = t.cloneNode(arrow.body)
        } else {
          body = t.blockStatement([t.returnStatement(t.cloneNode(arrow.body))])
        }

        candidatesInFile.push({
          type,
          normalizedName: funcName,
          normalizedBody: body,
          nodePath: path,
          localDependencies: new Set(),
        })

        inlineRegistry.set(id, funcName, {
          params: arrow.params as t.Identifier[],
          body,
          type,
        })
      }
    },
  })

  // 3. SECOND PASS: Scout dependencies for each candidate
  for (const candidate of candidatesInFile) {
    const funcPath = candidate.nodePath.isVariableDeclarator()
      ? (candidate.nodePath.get('init') as any)
      : candidate.nodePath

    candidate.localDependencies = scoutLocalDependencies(
      funcPath,
      localCandidateNames,
      importMap,
      inlineRegistry,
    )

    // Update the registry with the final candidate data
    inlineRegistry.set(id, candidate.normalizedName, {
      params: (funcPath.node as any).params,
      body: candidate.normalizedBody,
      type: candidate.type,
    })
  }

  return {
    candidatesInFile,
    importMap,
  }
}

export function resolveCandidateType(
  localComments: readonly t.Comment[] | null | undefined,
  exportComments: readonly t.Comment[] | null | undefined,
  opts: InlinePluginOptions,
  id: string,
  node: t.Node,
): InlineCandidateType {
  const NONE = InlineCandidateType.NONE
  const localType = getDirective(localComments, opts)
  const exportType = getDirective(exportComments, opts)

  if (localType !== NONE && exportType !== NONE) {
    throw makeErrorManager(id).makeUsageError('conflicting directives found', node)
  }

  if (localType !== NONE) return localType
  if (exportType !== NONE) return exportType

  return NONE
}

export function getDirective(comments: readonly t.Comment[] | null | undefined, opts: InlinePluginOptions): InlineCandidateType {
  if (comments?.some(c => c.value.includes(opts.inlineIdentifier))) return InlineCandidateType.INLINE
  if (comments?.some(c => c.value.includes(opts.inlineMacroIdentifier))) return InlineCandidateType.MACRO

  return InlineCandidateType.NONE
}

/**
 * Traverses a function to find external references that could be inlinable functions.
 * Using the live 'path.scope' here avoids the Null pointer error.
 */
function scoutLocalDependencies(
  funcPath: any,
  localCandidateNames: Set<string>,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
): Set<string> {
  const localDeps = new Set<string>()

  funcPath.traverse({
    Identifier(path: any) {
      if (!path.isReferencedIdentifier()) return
      const name = path.node.name

      // Ignore variables bound specifically inside this function (params/locals)
      // Top-level module variables will now correctly pass through.
      if (isOwnedByFunction(name, path, funcPath.scope)) return

      // If it's a local candidate, we MUST track it for sorting/cycle detection
      if (localCandidateNames.has(name)) {
        localDeps.add(name)
        return
      }

      // If it's an import, check if the source is in the registry
      const imported = importMap.get(name)
      if (imported && inlineRegistry.has(imported.sourcePath, imported.originalName)) {
        // This is an external dependency. We don't need to sort it
        // locally, but the executeInlining phase will handle it.
        return
      }
    },
    Function(p: any) {
      p.skip()
    },
  })

  return localDeps
}
function isOwnedByFunction(name: string, currentPath: any, funcScope: any): boolean {
  const binding = currentPath.scope.getBinding(name)
  if (!binding) return false
  let scope = binding.scope
  while (scope) {
    if (scope === funcScope) return true
    scope = scope.parent // walk up the tree
  }
  return false
}