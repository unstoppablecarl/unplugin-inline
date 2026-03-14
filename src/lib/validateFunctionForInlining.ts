import { type NodePath, type Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { InlinePluginOptions, ResolvedImport } from '../_types'
import type { ErrorManager } from '../ErrorManager'
import type { InlineRegistry } from '../InlineRegistry'

export function validateFunctionForInlining(
  id: string,
  opts: InlinePluginOptions,
  definitionPath: NodePath<t.FunctionDeclaration | t.VariableDeclarator>,
  errorManager: ErrorManager,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
): boolean {
  let isValid = true
  const isArrow = definitionPath.isVariableDeclarator()

  const funcPath = isArrow
    ? (definitionPath.get('init') as NodePath<t.ArrowFunctionExpression>)
    : (definitionPath as NodePath<t.FunctionDeclaration>)

  const funcName = isArrow
    ? (definitionPath.node.id as t.Identifier).name
    : (funcPath.node as t.FunctionDeclaration).id!.name

  const extendedGlobals = new Set([...opts.allowedGlobals])
  const targetNode = definitionPath.node

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
    isValid = false
  }

  if (funcPath.node.generator) {
    errorManager.recordError(`Cannot inline function '${funcName}': generator functions are not supported.`, funcPath.node)
    isValid = false
  }

  if (!isValid) {
    return false
  }

  const visitor: Visitor = {
    ThisExpression(path) {
      errorManager.recordError(`Cannot inline function '${funcName}': uses 'this' keyword.`, targetNode)
      isValid = false
      path.stop()
    },

    Identifier(path) {
      if (!path.isReferencedIdentifier()) return
      const name = path.node.name

      // Check for 'arguments' keyword
      if (name === 'arguments') {
        errorManager.recordError(`Cannot inline function '${funcName}': uses 'arguments' keyword.`, targetNode)
        isValid = false
        path.stop()
        return
      }

      const isBoundLocally = path.scope.hasBinding(name)
      const isGlobal = extendedGlobals.has(name) || (typeof globalThis !== 'undefined' && name in globalThis)
      let isRegistryFunction = false
      const imported = importMap.get(name)

      if (imported) {
        // Cross-file check
        isRegistryFunction = inlineRegistry.has(imported.sourcePath, imported.originalName)
      } else {
        // Peer-function check (same file)
        isRegistryFunction = inlineRegistry.has(id, name)
      }

      /**
       * Purity Check:
       * Allow if:
       * 1. Bound within the function (local var, param, or nested function)
       * 2. It is a known global (Math, console, etc.)
       * 3. It is another function marked for inlining (Phase 2 handles this)
       */
      if (!isBoundLocally && !isGlobal && !isRegistryFunction) {
        errorManager.recordError(
          `Cannot inline function '${funcName}': references external variable or non-inlinable function '${name}'. Inlined functions must be pure.`,
          targetNode,
        )
        isValid = false
        path.stop()
      }
    },

    CallExpression(path) {
      const callee = path.node.callee
      // Direct Recursion Check
      if (t.isIdentifier(callee) && callee.name === funcName) {
        errorManager.recordError(`Cannot inline function '${funcName}': recursive calls are not supported.`, targetNode)
        isValid = false
        path.stop()
      }
    },

    AssignmentExpression(path) {
      const left = path.node.left
      if (t.isIdentifier(left)) {
        // Mutation Check: Variable must be owned by this function's scope
        if (!isOwnedByFunction(left.name, path)) {
          errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${left.name}'.`, targetNode)
          isValid = false
        }
      }
    },

    UpdateExpression(path) {
      const arg = path.node.argument
      if (t.isIdentifier(arg)) {
        if (!isOwnedByFunction(arg.name, path)) {
          errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${arg.name}'.`, targetNode)
          isValid = false
        }
      }
    },

    Function(childPath) {
      childPath.skip()
    },
  }

  const bodyPath = funcPath.get('body') as NodePath<t.Node>

  bodyPath.traverse(visitor)
  /**
   * CRITICAL: We must NOT use { noScope: true } here.
   * By allowing Babel to crawl the scope, path.scope.hasBinding() can
   * correctly identify variables declared INSIDE the function body.
   */
  // traverse(definitionPath.node.body, visitor, definitionPath.scope)

  return isValid
}

// export function isUsedInShortCircuit(path: NodePath<t.CallExpression>): boolean {
//   let current: NodePath | null = path
//   const stmt = path.getStatementParent()
//
//   while (current && current !== stmt) {
//     const parent = current.parentPath!
//     if (!parent) break
//
//     // Right side of && or ||
//     if (parent.isLogicalExpression() && current.key === 'right') {
//       return true
//     }
//
//     // Consequent or Alternate of a ternary (a ? b : c)
//     if (parent.isConditionalExpression() && (current.key === 'consequent' || current.key === 'alternate')) {
//       return true
//     }
//
//     // Right side of logical assignment (a ||= b)
//     if (parent.isAssignmentExpression() && ['||=', '&&=', '??='].includes(parent.node.operator) && current.key === 'right') {
//       return true
//     }
//
//     // Optional chaining (a?.b())
//     if (parent.isOptionalCallExpression() || parent.isOptionalMemberExpression()) {
//       return true
//     }
//
//     current = parent
//   }
//
//   return false
// }

// Inside your CallExpression visitor
// const calledName = path.node.callee.name
// const dependency = inlineRegistry.get(id, calledName)
//
// if (dependency) {
//   if (isUsedInShortCircuit(path)) {
//     errorManager.recordError(`Cannot inline function '${calledName}': used in short-circuiting expression.`, path.node)
//     throw errorManager.makeValidationError()
//   }
//
//   executeInlining(path, opts, dependency)
// }
