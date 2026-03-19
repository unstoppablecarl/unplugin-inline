import { type NodePath, type Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import { type InlineCandidate, InlineCandidateType, type InlinePluginOptions, type ResolvedImport } from '../_types'
import type { ErrorManager } from './ErrorManager'
import type { InlineRegistry } from './InlineRegistry'

export function validateFunctionForInlining(
  id: string,
  opts: InlinePluginOptions,
  candidate: InlineCandidate,
  errorManager: ErrorManager,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
) {
  const definitionPath = candidate.nodePath
  const isArrow = definitionPath.isVariableDeclarator()
  const funcPath = isArrow ? (definitionPath.get('init') as NodePath<t.ArrowFunctionExpression>) : (definitionPath as NodePath<t.FunctionDeclaration>)

  const funcName = candidate.normalizedName
  const extendedGlobals = new Set([...opts.allowedGlobals])
  const targetNode = definitionPath.node

  if (candidate.type === InlineCandidateType.MACRO) {
    validateMacro(candidate.normalizedBody, errorManager)
  }

  const isOwnedByFunction = (name: string, currentPath: NodePath): boolean => {
    const binding = currentPath.scope.getBinding(name)

    if (!binding) return false

    let scope = binding.scope

    while (scope) {
      if (scope === funcPath.scope) return true

      scope = scope.parent
    }

    return false
  }

  if (funcPath.node.async) {
    errorManager.recordError(`Cannot inline function '${funcName}': async functions are not supported.`, funcPath.node)
  }

  if (funcPath.node.generator) {
    errorManager.recordError(`Cannot inline function '${funcName}': generator functions are not supported.`, funcPath.node)
  }

  if (errorManager.hasValidationErrors()) return

  const visitor: Visitor = {
    ThisExpression(path) {
      errorManager.recordError(`Cannot inline function '${funcName}': uses 'this' keyword.`, targetNode)
      path.stop()
    },
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return

      const name = path.node.name

      if (name === 'arguments') {
        errorManager.recordError(`Cannot inline function '${funcName}': uses 'arguments' keyword.`, targetNode)
        path.stop()
        return
      }

      const isBoundLocally = path.scope.hasBinding(name)
      const isGlobal = extendedGlobals.has(name) || (typeof globalThis !== 'undefined' && name in globalThis)
      let isRegistryFunction = false
      const imported = importMap.get(name)

      if (imported) {
        isRegistryFunction = inlineRegistry.has(imported.sourcePath, imported.originalName)
      } else {
        isRegistryFunction = inlineRegistry.has(id, name)
      }

      if (!isBoundLocally && !isGlobal && !isRegistryFunction) {
        errorManager.recordError(`Cannot inline function '${funcName}': references external variable or non-inlinable function '${name}'. Inlined functions must be pure.`, targetNode)
        path.stop()
      }
    },
    CallExpression(path) {
      const callee = path.node.callee

      if (t.isIdentifier(callee) && callee.name === funcName) {
        errorManager.recordError(`Cannot inline function '${funcName}': recursive calls are not supported.`, targetNode)
        path.stop()
      }
    },
    AssignmentExpression(path) {
      const left = path.node.left

      if (t.isIdentifier(left)) {
        if (!isOwnedByFunction(left.name, path)) {
          errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${left.name}'.`, targetNode)
        }
      }
    },
    UpdateExpression(path) {
      const arg = path.node.argument

      if (t.isIdentifier(arg)) {
        if (!isOwnedByFunction(arg.name, path)) {
          errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${arg.name}'.`, targetNode)
        }
      }
    },
    Function(childPath) {
      childPath.skip()
    },
  }

  const bodyPath = funcPath.get('body') as NodePath<t.Node>

  bodyPath.traverse(visitor)
}

export function getMacroExpression(body: t.Node): t.Expression | null {
  if (t.isExpression(body)) return body

  if (t.isBlockStatement(body)) {
    if (body.body.length !== 1) return null

    const firstStmt = body.body[0]

    if (t.isReturnStatement(firstStmt) && firstStmt.argument) return firstStmt.argument
  }

  return null
}

export function validateMacro(body: t.Node, errorManager: ErrorManager): t.Expression | null {
  if (t.isExpression(body)) return body

  if (t.isBlockStatement(body)) {
    if (body.body.length !== 1) {
      errorManager.recordError('Macros can only have one statement.', body)
      return null
    }

    const firstStmt = body.body[0]

    if (!t.isReturnStatement(firstStmt)) {
      errorManager.recordError('Macro block statements must consist of a single return statement.', firstStmt)
      return null
    }

    if (!firstStmt.argument) {
      errorManager.recordError('Macro return statement must return a value.', firstStmt)
      return null
    }

    return firstStmt.argument
  }

  errorManager.recordError('Macros must resolve to a single pure expression.', body)
  return null
}

export function isUsedInShortCircuit(path: NodePath<t.CallExpression>): boolean {
  let current: NodePath | null = path
  const stmt = path.getStatementParent()

  while (current && current !== stmt) {
    const parent: NodePath<t.Node> = current.parentPath!

    if (!parent) break

    if (parent.isLogicalExpression() && current.key === 'right') return true

    if (parent.isConditionalExpression() && (current.key === 'consequent' || current.key === 'alternate')) return true

    if (parent.isAssignmentExpression() && ['||=', '&&=', '??='].includes(parent.node.operator) && current.key === 'right') return true

    if (parent.isOptionalCallExpression() || parent.isOptionalMemberExpression()) return true

    current = parent
  }

  return false
}