import traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { InlinePluginOptions } from '../_types'

export function executeInlining(
  path: NodePath<t.CallExpression>,
  opts: InlinePluginOptions,
  blueprint: { params: (t.Identifier | t.Pattern)[]; body: t.BlockStatement },
): void {
  const callee = path.node.callee as t.Identifier
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
            // FIX: Use funcPath.scope so it sees internal blueprint variables!
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
        // FIX: Use declPath.scope here as well
        const newName = declPath.scope.generateUid(`${prefix}${name}`)
        declPath.scope.rename(name, newName)
      }
    },
  }, path.scope)

  const argDecls = dummyFunc.params.map((renamedParam, i) => {
    const callerArg = callerArgs[i] || t.identifier('undefined')
    return t.variableDeclaration('const', [t.variableDeclarator(renamedParam as any, callerArg)])
  })

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
  if (parentStmt) {
    parentStmt.insertBefore([t.variableDeclaration('let', [t.variableDeclarator(resultId)]), labeledBlock])
    path.replaceWith(resultId)
  }
}