import type { ParseResult } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { ErrorManager } from './ErrorManager'
import type { InlineRegistry } from './InlineRegistry'

export function findAndValidate(
  id: string,
  inlineIdentifier: string,
  ast: ParseResult<t.File>,
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
) {
  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node
      const parentNode = path.parentPath.node

      // Check the function's own comments OR the parent's comments (for exported functions)
      const comments = node.leadingComments || (t.isExportNamedDeclaration(parentNode) ? parentNode.leadingComments : null)
      const hasDirective = comments?.some((c) => c.value.includes(inlineIdentifier))

      if (!hasDirective || !node.id) return

      const funcName = node.id.name
      let isValid = true

      if (node.async) {
        errorManager.recordError(`Cannot inline async function '${funcName}'`, node)
        isValid = false
      }

      if (node.generator) {
        errorManager.recordError(`Cannot inline generator function '${funcName}'`, node)
        isValid = false
      }

      path.traverse({
        ThisExpression(innerPath) {
          errorManager.recordError(`Cannot inline function '${funcName}': uses 'this' keyword.`, innerPath.node)
          isValid = false
          innerPath.stop()
        },
        Identifier(innerPath) {
          if (innerPath.node.name === 'arguments') {
            errorManager.recordError(`Cannot inline function '${funcName}': uses 'arguments' keyword.`, innerPath.node)
            isValid = false
            innerPath.stop()
          }
        },
        AssignmentExpression(innerPath) {
          const left = innerPath.node.left

          if (t.isIdentifier(left) && !path.scope.hasOwnBinding(left.name)) {
            errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${left.name}'.`, innerPath.node)
            isValid = false
          }
        },
        UpdateExpression(innerPath) {
          const arg = innerPath.node.argument

          if (t.isIdentifier(arg) && !path.scope.hasOwnBinding(arg.name)) {
            errorManager.recordError(`Cannot inline function '${funcName}': mutates outer scope variable '${arg.name}'.`, innerPath.node)
            isValid = false
          }
        },
        CallExpression(innerPath) {
          const callee = innerPath.node.callee

          if (t.isIdentifier(callee) && callee.name === funcName) {
            errorManager.recordError(`Cannot inline function '${funcName}': recursive calls are not supported.`, innerPath.node)
            isValid = false
            innerPath.stop()
          }
        },
      })

      if (isValid) {
        inlineRegistry.set(id, funcName, {
          params: node.params as t.Identifier[],
          body: node.body,
        })
      }
    },
    VariableDeclaration(path) {
      const node = path.node;
      const hasComment = node.leadingComments?.some(c => c.value.includes(inlineIdentifier));

      if (hasComment) {
        // We need to see if there is a CallExpression anywhere inside this declaration
        let containsCall = false;

        // Check all declarators (e.g., const a = func(), b = 2)
        for (const decl of node.declarations) {
          if (t.isCallExpression(decl.init)) {
            containsCall = true;
            break;
          }
          // Also check for calls wrapped in things like 'void' or parentheses
          path.traverse({
            CallExpression() {
              containsCall = true;
            },
            Function(childPath) {
              childPath.skip();
            }
          }, { containsCall });
        }

        if (!containsCall) {
          // Double check: Is this comment actually on this node,
          // or did Babel shift it from a deleted function?
          // If the comment's location is significantly different from the node's location,
          // it might be a ghost comment.
          errorManager.recordError(
            `Invalid ${inlineIdentifier} usage: No function call found to inline.`,
            path.node,
          );
        }
      }
    },
  })
}