import _traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { InlineCandidateType, type InlinePluginOptions, type InlineTarget } from '../_types'
import type { ErrorManager } from './ErrorManager'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse

export function executeInlining(
  path: NodePath<t.CallExpression>,
  opts: InlinePluginOptions,
  blueprint: InlineTarget,
  errorManager: ErrorManager,
): void {
  const callee = path.node.callee

  if (!t.isIdentifier(callee)) return

  const funcName = callee.name
  const args = path.node.arguments as t.Expression[]
  const params = blueprint.params as t.Identifier[]
  const macroExpr = getMacroExpression(blueprint.body)

  let shouldUseMacro = false

  if (blueprint.type === InlineCandidateType.MACRO) {
    if (!macroExpr) throw new Error(`Invariant violation: Invalid macro blueprint for '${funcName}' bypassed Phase 1 validation.`)

    const safetyCheck = checkSubstitutionSafety(args, params, macroExpr)

    if (!safetyCheck.safe) {
      const { argIndex, paramName, refCount } = safetyCheck
      const targetArgNode = args[argIndex] || path.node

      errorManager.recordError(`Cannot safely expand macro '${funcName}': The argument at index ${argIndex} (passed to parameter '${paramName}') contains potential side-effects (e.g., a function call or mutation). Because '${paramName}' is referenced ${refCount} times in the macro body, expanding it would cause the side-effect to be evaluated ${refCount} times instead of exactly once.`, targetArgNode)
      throw errorManager.makeValidationError()
    }

    shouldUseMacro = true
  } else if (
    opts.autoConvertInlineToMacro &&
    blueprint.type === InlineCandidateType.INLINE &&
    macroExpr
  ) {
    const safetyCheck = checkSubstitutionSafety(args, params, macroExpr)

    if (safetyCheck.safe) {
      shouldUseMacro = true
    }
  }

  if (shouldUseMacro && macroExpr) {
    const tempProgram = t.program([t.expressionStatement(t.cloneNode(macroExpr))])

    traverse(tempProgram, {
      Identifier(idPath) {
        const paramIndex = params.findIndex(p => p.name === idPath.node.name)

        if (paramIndex !== -1) {
          const arg = args[paramIndex]

          if (arg) {
            idPath.replaceWith(t.parenthesizedExpression(t.cloneNode(arg)))
            idPath.skip()
          }
        }
      },
      noScope: true,
    }, path.scope)

    const mutatedExpr = (tempProgram.body[0] as t.ExpressionStatement).expression

    path.replaceWith(t.parenthesizedExpression(mutatedExpr))
    return
  }

  const resultId = path.scope.generateUidIdentifier(`${funcName}Result`)
  const labelId = path.scope.generateUidIdentifier(`${funcName}Label`)

  const callerArgs = path.node.arguments.map(arg => t.cloneNode(arg as t.Expression))

  const dummyFunc = t.functionDeclaration(t.identifier('__dummy__'), blueprint.params.map(p => t.cloneNode(p as any)), t.cloneNode(blueprint.body as t.BlockStatement))

  const tempFile = t.file(t.program([dummyFunc]))

  traverse(tempFile, {
    FunctionDeclaration(funcPath) {
      if (funcPath.node.id?.name === '__dummy__') {
        funcPath.get('params').forEach(paramPath => {
          const bindings = paramPath.getBindingIdentifiers()

          for (const name in bindings) {
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

  const argDecls = []

  if (dummyFunc.params.length > 0 || callerArgs.length > 0) {
    argDecls.push(
      t.variableDeclaration('let', [
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

  const parentBlock = path.findParent(p => p.isBlockStatement())

  if (parentBlock) {
    parentStmt.insertBefore([
      t.variableDeclaration('let', [t.variableDeclarator(resultId)]),
      labeledBlock,
    ])
    path.replaceWith(resultId)
  } else {
    const arrowParent = path.findParent(p => p.isArrowFunctionExpression())

    if (arrowParent && t.isArrowFunctionExpression(arrowParent.node)) {
      const node = arrowParent.node

      if (!t.isBlockStatement(node.body)) {
        const bodyPath = arrowParent.get('body') as NodePath<t.Expression>
        const originalBody = t.cloneNode(bodyPath.node)

        bodyPath.replaceWith(
          t.blockStatement([
            t.returnStatement(originalBody),
          ]),
        )

        executeInlining(path, opts, blueprint, errorManager)
        return
      }
    }

    parentStmt.insertBefore([
      t.variableDeclaration('let', [t.variableDeclarator(resultId)]),
      labeledBlock,
    ])
    path.replaceWith(resultId)
  }
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

function isPureNode(node: t.Node): boolean {
  if (t.isLiteral(node)) return true
  if (t.isIdentifier(node)) return true
  if (t.isThisExpression(node)) return true

  return false
}

type SubstitutionCheckResult =
  | {
  safe: true
}
  | {
  safe: false
  paramName: string
  argIndex: number
  refCount: number
}

function checkSubstitutionSafety(
  args: t.Expression[],
  params: t.Identifier[],
  expr: t.Expression,
): SubstitutionCheckResult {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const param = params[i]

    if (!arg) continue
    if (!param) continue

    if (!isPureNode(arg)) {
      let count = 0
      const tempProg = t.program([t.expressionStatement(expr)])

      traverse(tempProg, {
        Identifier(idPath) {
          if (idPath.node.name === param.name && idPath.isReferencedIdentifier()) {
            count++
          }
        },
        noScope: true,
      })

      if (count !== 1) {
        return {
          safe: false,
          paramName: param.name,
          argIndex: i,
          refCount: count,
        }
      }
    }
  }

  return {
    safe: true,
  }
}