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

  // 1. ISOLATE CALLER ARGUMENTS
  // We clone them immediately and keep them completely separate from the AST
  // we are about to traverse. This permanently prevents "_t_n = _t_n".
  const callerArgs = path.node.arguments.map(arg => t.cloneNode(arg as t.Expression))

  // 2. CREATE A DUMMY FUNCTION
  // By putting the parameters and body into a real FunctionDeclaration,
  // Babel's scope engine will perfectly map parameters to their internal usages.
  const dummyFunc = t.functionDeclaration(
    t.identifier('__dummy__'),
    blueprint.params.map(p => t.cloneNode(p as any)),
    t.cloneNode(blueprint.body)
  )

  const tempFile = t.file(t.program([dummyFunc]))

  // 3. THE UNIFIED HYGIENE PASS
  traverse(tempFile, {
    FunctionDeclaration(funcPath) {
      // Only process the parameters of our dummy wrapper, not nested functions
      if (funcPath.node.id?.name === '__dummy__') {
        funcPath.get('params').forEach(paramPath => {
          const bindings = paramPath.getBindingIdentifiers()
          for (const name in bindings) {
            const newName = path.scope.generateUid(`_arg_${name}`)
            // Babel perfectly renames the param AND its usages in the body
            funcPath.scope.rename(name, newName)
          }
        })
      }
    },
    VariableDeclaration(declPath) {
      // Rename local variables for hygiene
      const bindings = declPath.getBindingIdentifiers()
      for (const name in bindings) {
        const prefix = opts.variableNamePrefix || '_in_'
        const newName = path.scope.generateUid(`${prefix}${name}`)
        declPath.scope.rename(name, newName)
      }
    }
  }, path.scope)

  // 4. ASSEMBLE ARGUMENT DECLARATIONS
  // Now dummyFunc.params contains the RENAMED parameters (e.g., _arg_a, _arg_b)
  // And callerArgs contains the ORIGINAL caller values (e.g., 10, 20)
  const argDecls = dummyFunc.params.map((renamedParam, i) => {
    const callerArg = callerArgs[i] || t.identifier('undefined')
    return t.variableDeclaration('const', [
      t.variableDeclarator(renamedParam as any, callerArg)
    ])
  })

  // 5. ASSEMBLE FINAL BLOCK
  // We extract the renamed body out of the dummy function
  const finalStatements = [...argDecls, ...dummyFunc.body.body]
  const labeledBlock = t.labeledStatement(labelId, t.blockStatement(finalStatements))

  // 6. TRANSFORM RETURNS
  traverse(labeledBlock, {
    ReturnStatement(returnPath) {
      const val = returnPath.node.argument || t.identifier('undefined')
      returnPath.replaceWithMultiple([
        t.expressionStatement(t.assignmentExpression('=', resultId, t.cloneNode(val))),
        t.breakStatement(labelId),
      ])
    },
    Function(p) { p.skip() },
    noScope: true,
  })

  // 7. INJECT
  const parentStmt = path.getStatementParent()
  if (parentStmt) {
    parentStmt.insertBefore([
      t.variableDeclaration('let', [t.variableDeclarator(resultId)]),
      labeledBlock,
    ])
    path.replaceWith(resultId)
  }
}