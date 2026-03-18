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

  // PRE-RESOLVE IMPORTS
  // We scan the top-level body for ImportDeclarations
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

  // SCAN & PROVISIONAL REGISTRATION
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
        const body = t.cloneNode(node.body)

        inlineRegistry.set(id, funcName, {
          params: node.params as t.Identifier[],
          body,
          type,
        })

        candidatesInFile.push({
          type,
          normalizedName: funcName,
          normalizedBody: body,
          nodePath: path,
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
        })

        inlineRegistry.set(id, funcName, {
          params: arrow.params as t.Identifier[],
          body,
          type,
        })
      }
    },
  })

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
    const errManager = makeErrorManager(id)

    errManager.recordError('conflicting directives found', node)
    throw errManager.makeUsageError()
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

function isPureNode(node: t.Node): boolean {
  // Literals (1, "a", true) and Identifiers (x, y) are pure.
  // UpdateExpressions (i++) or CallExpressions (foo()) are NOT.
  if (t.isLiteral(node)) return true
  if (t.isIdentifier(node)) return true
  if (t.isThisExpression(node)) return true

  return false
}

function countReferences(
  bodyPath: any,
  paramName: string,
): number {
  let count = 0

  bodyPath.traverse({
    Identifier(path: any) {
      const isMatch = path.node.name === paramName
      const isRef = path.isReferencedIdentifier()

      if (isMatch && isRef) count++
    },
  })

  return count
}

export function isSafeToSubstitute(
  args: t.Node[],
  params: t.Identifier[],
  bodyPath: any,
): boolean {
  // 1. Body MUST be an expression, not a complex block statement
  if (t.isBlockStatement(bodyPath.node)) {
    return false
  }

  // 2. Check each argument for side-effects vs reference count
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const param = params[i]

    if (!arg) continue
    if (!param) continue

    const isPure = isPureNode(arg)

    if (!isPure) {
      const refCount = countReferences(bodyPath, param.name)

      // If an argument has side effects (like i++), it MUST be evaluated
      // exactly once. If refCount is 0, it skips the side effect.
      // If refCount > 1, it duplicates the side effect.
      if (refCount !== 1) {
        return false
      }
    }
  }

  return true
}