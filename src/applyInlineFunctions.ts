import type { ParseResult } from '@babel/parser'
import traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { Resolver, InlineTarget } from './_types'
import type { ErrorManager } from './ErrorManager'
import { getInlineTarget } from './getInlineTarget'
import type { InlineRegistry } from './InlineRegistry'

export async function applyInlineFunctions(
  id: string,
  inlineIdentifier: string,
  ast: ParseResult<t.File>,
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
  resolver: Resolver,
) {
  const callPaths: NodePath<t.CallExpression>[] = []

  // 1. Collect all CallExpressions
  traverse(ast, {
    CallExpression(path) {
      callPaths.push(path)
    },
  })

  // 2. Process Bottom-Up (Reversed)
  // This ensures inner calls are inlined before their parents are moved/cloned.
  for (const path of callPaths.reverse()) {
    // Safety check: is the path still valid and attached to the tree?
    if (!path.node || !path.scope || !path.hub) continue

    const funcData = await getInlineTarget(
      inlineIdentifier,
      path,
      inlineRegistry,
      errorManager,
      id,
      resolver
    )

    if (funcData) {
      performInlining(path, funcData, errorManager)
    }
  }
}

function performInlining(
  path: NodePath<t.CallExpression>,
  funcData: InlineTarget,
  errorManager: ErrorManager,
) {
  const callee = path.node.callee as t.Identifier
  const funcName = callee.name

  const parentStmt = path.getStatementParent()
  if (!parentStmt) return

  // Short-circuiting safety check
  const unsafeParent = path.findParent((p) => p.isLogicalExpression() || p.isConditionalExpression())
  if (unsafeParent) {
    errorManager.recordError(
      `Cannot inline function '${funcName}': used in short-circuiting expression.`,
      path.node
    )
    throw errorManager.makeUsageError()
  }

  const resultId = path.scope.generateUidIdentifier(`${funcName}Result`)
  const labelId = path.scope.generateUidIdentifier(`${funcName}Label`)
  const paramMap = new Map<string, t.Identifier>()

  // Map Arguments (cloning to keep AST clean)
  const argDecls = funcData.params.map((param, i) => {
    const argNode = path.node.arguments[i] || t.identifier('undefined')
    const newParamId = path.scope.generateUidIdentifier(param.name)
    paramMap.set(param.name, newParamId)
    return t.variableDeclaration('const', [
      t.variableDeclarator(newParamId, t.cloneNode(argNode as t.Expression))
    ])
  })

  // Clone body and remap internal identifiers
  const tempProgram = t.program([
    t.blockStatement(funcData.body.body.map((n) => t.cloneNode(n))),
  ])
  const tempFile = t.file(tempProgram, [], [])

  traverse(tempFile, {
    Identifier(idPath: NodePath<t.Identifier>) {
      const name = idPath.node.name
      if (paramMap.has(name) && idPath.isReferencedIdentifier() && !idPath.scope.hasBinding(name)) {
        idPath.replaceWith(paramMap.get(name)!)
      }
    },
    VariableDeclarator(varPath: NodePath<t.VariableDeclarator>) {
      if (t.isIdentifier(varPath.node.id)) {
        const oldName = varPath.node.id.name
        const newId = path.scope.generateUidIdentifier(oldName)
        varPath.scope.rename(oldName, newId.name)
      }
    },
  })

  const transformedBody = (tempProgram.body[0] as t.BlockStatement).body
  const resultDecl = t.variableDeclaration('let', [t.variableDeclarator(resultId)])
  const labeledBlock = t.labeledStatement(
    labelId,
    t.blockStatement([...argDecls, ...transformedBody])
  )

  // Inject hoisted block
  const inserted = parentStmt.insertBefore([resultDecl, labeledBlock])
  const labeledStmtPath = inserted[1]

  // Handle returns
  labeledStmtPath.traverse({
    ReturnStatement(returnPath: NodePath<t.ReturnStatement>) {
      const val = returnPath.node.argument || t.identifier('undefined')
      const assign = t.expressionStatement(t.assignmentExpression('=', resultId, val))
      const breakStmt = t.breakStatement(labelId)

      if (Array.isArray(returnPath.container)) {
        returnPath.replaceWithMultiple([assign, breakStmt])
      } else {
        returnPath.replaceWith(t.blockStatement([assign, breakStmt]))
      }
    },
    Function(childPath: NodePath<t.Function>) { childPath.skip() },
  })

  // Finally replace the call with the result variable
  path.replaceWith(resultId)
}