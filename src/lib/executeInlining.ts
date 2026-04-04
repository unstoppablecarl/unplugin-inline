import _generate from '@babel/generator'
import _traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { InlineCandidateType, type InlinePluginOptions, type InlineTarget, ResolvedImport } from '../_types'
import type { ErrorManager } from './ErrorManager'
import type { InlineRegistry } from './InlineRegistry'
import { isUsedInShortCircuit } from './validateFunctionForInlining'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse
const generate = ((_generate as any).default || _generate) as typeof _generate

const DEBUG = process.env.DEBUG_UNPLUGIN_INLINE === 'true'

export function applyInlining(
  id: string,
  opts: any,
  ast: t.File,
  importMap: Map<string, ResolvedImport>,
  errorManager: ErrorManager,
  inlineRegistry: InlineRegistry,
): number {
  let inlinedCount = 0
  
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return
      const name = path.node.callee.name

      // Avoid self-recursion
      const parentFunc = path.getFunctionParent()
      let parentName: string | undefined
      if (parentFunc) {
        if (t.isFunctionDeclaration(parentFunc.node)) {
          parentName = parentFunc.node.id?.name
        } else if (parentFunc.parentPath.isVariableDeclarator() && t.isIdentifier(parentFunc.parentPath.node.id)) {
          parentName = parentFunc.parentPath.node.id.name
        }
      }
      if (name === parentName) return

      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)
      if (blueprint) {
        if (DEBUG) console.log(`[unplugin-inline] Attempting to inline '${name}' in ${id}`)
        if (isUsedInShortCircuit(path)) {
          throw errorManager.makeValidationError(`Cannot inline function '${name}': used in short-circuiting expression.`, path.node)
        }
        executeInlining(path, opts, blueprint, errorManager)
        inlinedCount++
      }
    },
    Function(p) {
      const node = p.node
      let name: string | undefined
      if (t.isFunctionDeclaration(node) && node.id) {
        name = node.id.name
      } else if (p.parentPath.isVariableDeclarator() && t.isIdentifier(p.parentPath.node.id)) {
        name = p.parentPath.node.id.name
      }
      if (name && inlineRegistry.has(id, name)) {
        p.skip()
      }
    },
  })
  
  return inlinedCount
}

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

  if (DEBUG) {
     console.log(`[unplugin-inline] executeInlining context for '${funcName}':`)
     console.log(`  blueprint.type: ${blueprint.type}`)
     console.log(`  opts.autoConvertInlineToMacro: ${opts.autoConvertInlineToMacro}`)
     console.log(`  macroExpr: ${macroExpr ? 'FOUND' : 'NULL'}`)
  }

  if (blueprint.type === InlineCandidateType.MACRO) {
    if (!macroExpr) {
      throw errorManager.makeInternalError(`Invariant violation: Invalid macro blueprint for '${funcName}' bypassed Phase 1 validation.`, path.node)
    }

    const safetyCheck = checkSubstitutionSafety(args, params, macroExpr)
    if (DEBUG) console.log(`[unplugin-inline] Macro safety check for '${funcName}': ${safetyCheck.safe ? 'SAFE' : 'UNSAFE'}`)

    if (!safetyCheck.safe) {
      const { argIndex, paramName, refCount } = safetyCheck
      const targetArgNode = args[argIndex] || path.node

      throw errorManager.makeValidationError(`Cannot safely expand macro '${funcName}': The argument at index ${argIndex} (passed to parameter '${paramName}') contains potential side-effects (e.g., a function call or mutation). Because '${paramName}' is referenced ${refCount} times in the macro body, expanding it would cause the side-effect to be evaluated ${refCount} times instead of exactly once.`, targetArgNode)
    }

    shouldUseMacro = true
  } else if (
    opts.autoConvertInlineToMacro &&
    blueprint.type === InlineCandidateType.INLINE &&
    macroExpr
  ) {
    const safetyCheck = checkSubstitutionSafety(args, params, macroExpr)
    if (DEBUG) console.log(`[unplugin-inline] Auto-macro conversion safety check for '${funcName}': ${safetyCheck.safe ? 'SAFE' : 'UNSAFE'}`)

    if (safetyCheck.safe) {
      shouldUseMacro = true
    }
  }

  if (shouldUseMacro && macroExpr) {
    const mutatedExpr = substituteMacro(macroExpr, params, args, path.scope)
    
    if (DEBUG) {
      const before = generate(path.node).code
      const after = generate(mutatedExpr).code
      console.log(`[unplugin-inline] Macro replaced: ${before} -> ${after}`)
    }

    path.replaceWith(t.parenthesizedExpression(mutatedExpr))
    return
  }

  if (DEBUG) console.log(`[unplugin-inline] Falling back to block-inlining for '${funcName}'`)

  const resultId = path.scope.generateUidIdentifier(`${funcName}Result`)
  const labelId = path.scope.generateUidIdentifier(`${funcName}Label`)

  const callerArgs = path.node.arguments.map(arg => t.cloneNode(arg as t.Expression))

  const dummyFunc = t.functionDeclaration(
    t.identifier('__dummy__'),
    blueprint.params.map(p => t.cloneNode(p as any)),
    t.cloneNode(blueprint.body as t.BlockStatement),
  )

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
        const prefix = opts.variableNamePrefix
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

function substituteMacro(expr: t.Expression, params: t.Identifier[], args: t.Expression[], scope: any): t.Expression {
  const cloned = t.cloneNode(expr)
  const tempProg = t.program([t.expressionStatement(cloned)])

  traverse(tempProg, {
    Identifier(p) {
      if (!p.isReferencedIdentifier()) return
      const idx = params.findIndex(param => param.name === p.node.name)
      if (idx !== -1) {
        const arg = args[idx] || t.identifier('undefined')
        const needsParens = !t.isIdentifier(arg) && !t.isLiteral(arg) && !t.isMemberExpression(arg)
        p.replaceWith(needsParens ? t.parenthesizedExpression(t.cloneNode(arg)) : t.cloneNode(arg))
        p.skip()
      }
    },
    noScope: true,
  }, scope)

  return (tempProg.body[0] as t.ExpressionStatement).expression
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

export function resolveBlueprint(
  name: string,
  currentFile: string,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
) {
  if (inlineRegistry.has(currentFile, name)) {
    return inlineRegistry.get(currentFile, name)
  }
  const imported = importMap.get(name)
  if (imported) {
    return inlineRegistry.get(imported.sourcePath, imported.originalName)
  }
}

export function verifyNoLeakedReferences(
  id: string,
  ast: t.File,
  importMap: Map<string, ResolvedImport>,
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
) {
  traverse(ast, {
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee)) return
      const name = path.node.callee.name
      const blueprint = resolveBlueprint(name, id, importMap, inlineRegistry)
      if (blueprint) {
        if (DEBUG) {
          console.warn(`[unplugin-inline] WARNING: Leaked reference to inlinable function '${name}' found in ${id}. This call was not inlined.`)
        }
      }
    },
  })
}
