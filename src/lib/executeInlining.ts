import _traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { InlinePluginOptions } from '../_types'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse

export function executeInlining(
  path: NodePath<t.CallExpression>,
  opts: InlinePluginOptions,
  blueprint: { params: (t.Identifier | t.Pattern)[]; body: t.BlockStatement },
): void {
  const callee = path.node.callee
  if (!t.isIdentifier(callee)) return

  const funcName = callee.name

  const resultId = path.scope.generateUidIdentifier(`${funcName}Result`)
  const labelId = path.scope.generateUidIdentifier(`${funcName}Label`)

  const callerArgs = path.node.arguments.map(arg => t.cloneNode(arg as t.Expression))

  // Function call with 3 arguments goes on one line
  const dummyFunc = t.functionDeclaration(t.identifier('__dummy__'), blueprint.params.map(p => t.cloneNode(p as any)), t.cloneNode(blueprint.body))

  const tempFile = t.file(t.program([dummyFunc]))

  traverse(tempFile, {
    FunctionDeclaration(funcPath) {
      if (funcPath.node.id?.name === '__dummy__') {
        funcPath.get('params').forEach(paramPath => {
          const bindings = paramPath.getBindingIdentifiers()
          for (const name in bindings) {
            // Use funcPath.scope so it sees internal blueprint variables
            const newName = funcPath.scope.generateUid(`_arg_${name}`)
            funcPath.scope.rename(name, newName)
          }
        })
      }
    },
    VariableDeclaration(declPath) {
      const bindings = declPath.getBindingIdentifiers()
      for (const name in bindings) {
        const prefix = opts.variableNamePrefix || '_in_'
        const newName = declPath.scope.generateUid(`${prefix}${name}`)
        declPath.scope.rename(name, newName)
      }
    },
  }, path.scope)

  // 4. ASSEMBLE ARGUMENT DECLARATIONS
  // Use array destructuring to perfectly map parameters to arguments
  // This automatically supports defaults (b = 10), destructuring ({x, y}), and rest (...args)
  const argDecls = []
  if (dummyFunc.params.length > 0 || callerArgs.length > 0) {
    argDecls.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.arrayPattern(dummyFunc.params as any),
          t.arrayExpression(callerArgs),
        ),
      ]),
    )
  }

  const finalStatements = [...argDecls, ...dummyFunc.body.body]
  const labeledBlock = t.labeledStatement(labelId, t.blockStatement(finalStatements))

  traverse(labeledBlock, {
    ReturnStatement(returnPath) {
      const val = returnPath.node.argument || t.identifier('undefined')
      returnPath.replaceWithMultiple([
        t.expressionStatement(t.assignmentExpression('=', resultId, t.cloneNode(val))),
        t.breakStatement(labelId),
      ])
    },
    Function(p) {
      p.skip()
    },
    noScope: true,
  })

  const parentStmt = path.getStatementParent()
  if (!parentStmt) return

  // Find the closest block (like a function body or if-statement block)
  const parentBlock = path.findParent(p => p.isBlockStatement())

  if (parentBlock) {
    // We are already in a block, just inject before the statement
    parentStmt.insertBefore([
      t.variableDeclaration('let', [t.variableDeclarator(resultId)]),
      labeledBlock,
    ])
    path.replaceWith(resultId)
  } else {
    // We are likely in an arrow function expression: (val) => level5(val)
    const arrowParent = path.findParent(p => p.isArrowFunctionExpression())

// 1. Narrow the type using the Babel type guard
    if (arrowParent && t.isArrowFunctionExpression(arrowParent.node)) {
      const node = arrowParent.node

      // 2. Only transform if it's an expression body (e.g., (x) => x + 1)
      if (!t.isBlockStatement(node.body)) {
        const bodyPath = arrowParent.get('body') as NodePath<t.Expression>
        const originalBody = t.cloneNode(bodyPath.node)

        // 3. Transform the body into a block statement
        bodyPath.replaceWith(
          t.blockStatement([
            t.returnStatement(originalBody),
          ]),
        )

        // 4. Re-run inlining now that the call is inside a block
        executeInlining(path, opts, blueprint)
        return
      }
    }

    // Fallback for top-level or other cases
    parentStmt.insertBefore([
      t.variableDeclaration('let', [t.variableDeclarator(resultId)]),
      labeledBlock,
    ])
    path.replaceWith(resultId)
  }
}