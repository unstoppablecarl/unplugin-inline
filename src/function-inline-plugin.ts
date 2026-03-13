import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { createUnplugin } from 'unplugin'

export interface InlinePluginOptions {
  inlineIdentifier?: string
}

export const inlinePlugin = createUnplugin((options: InlinePluginOptions = {}) => {
  const inlineIdentifier = options.inlineIdentifier || '@__INLINE__'

  return {
    name: 'unplugin-inline',
    enforce: 'pre',
    transformInclude(id) {
      const isTs = id.endsWith('.ts')
      const isJs = id.endsWith('.js')
      return isTs || isJs
    },
    transform(code, id) {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: [
          'typescript'
        ]
      })

      const inlineRegistry = new Map<string, {
        params: t.Identifier[]
        body: t.BlockStatement
      }>()

      const errors: string[] = []

      const reportError = (message: string, node: t.Node) => {
        const loc = node.loc
        let locationString = id

        if (loc) {
          const line = loc.start.line
          const col = loc.start.column
          locationString = `${id}:${line}:${col}`
        }

        const fullMessage = `${locationString} - ${message}`
        errors.push(fullMessage)
      }

      const getInlineTarget = (path: NodePath<t.CallExpression>) => {
        const callee = path.node.callee
        if (!t.isIdentifier(callee)) return null

        const funcName = callee.name
        const globalData = inlineRegistry.get(funcName)

        let isLocalInline = false
        let currentPath: NodePath<t.Node> | null = path

        while (currentPath && !currentPath.isStatement()) {
          if (currentPath.node.leadingComments?.some((c) => c.value.includes(inlineIdentifier))) {
            isLocalInline = true
            break
          }
          currentPath = currentPath.parentPath
        }

        if (!isLocalInline && currentPath?.node.leadingComments?.some((c) => c.value.includes(inlineIdentifier))) {
          isLocalInline = true
        }

        if (globalData) return globalData

        if (isLocalInline) {
          const binding = path.scope.getBinding(funcName)
          if (binding && t.isFunctionDeclaration(binding.path.node)) {
            return {
              params: binding.path.node.params as t.Identifier[],
              body: binding.path.node.body
            }
          }
        }
        return null
      }

      // 1. DISCOVERY & INTERNAL VALIDATION
      traverse(ast, {
        FunctionDeclaration(path) {
          const comments = path.node.leadingComments || path.parentPath.node.leadingComments
          const hasDirective = comments?.some((c) => c.value.includes(inlineIdentifier))

          if (!hasDirective || !path.node.id) return

          const funcName = path.node.id.name
          let isValid = true

          if (path.node.async) {
            reportError(`Cannot inline async function '${funcName}'`, path.node)
            isValid = false
          }

          if (path.node.generator) {
            reportError(`Cannot inline generator function '${funcName}'`, path.node)
            isValid = false
          }

          path.traverse({
            ThisExpression(innerPath) {
              reportError(`Cannot inline function '${funcName}': uses 'this' keyword.`, innerPath.node)
              isValid = false
              innerPath.stop()
            },
            Identifier(innerPath) {
              if (innerPath.node.name === 'arguments') {
                reportError(`Cannot inline function '${funcName}': uses 'arguments' keyword.`, innerPath.node)
                isValid = false
                innerPath.stop()
              }
            },
            AssignmentExpression(innerPath) {
              const left = innerPath.node.left
              if (t.isIdentifier(left) && !path.scope.hasOwnBinding(left.name)) {
                reportError(`Cannot inline function '${funcName}': mutates outer scope variable '${left.name}'.`, innerPath.node)
                isValid = false
              }
            },
            UpdateExpression(innerPath) {
              const arg = innerPath.node.argument
              if (t.isIdentifier(arg) && !path.scope.hasOwnBinding(arg.name)) {
                reportError(`Cannot inline function '${funcName}': mutates outer scope variable '${arg.name}'.`, innerPath.node)
                isValid = false
              }
            },
            CallExpression(innerPath) {
              const callee = innerPath.node.callee
              if (t.isIdentifier(callee) && callee.name === funcName) {
                reportError(`Cannot inline function '${funcName}': recursive calls are not supported.`, innerPath.node)
                isValid = false
                innerPath.stop()
              }
            }
          })

          if (isValid) {
            inlineRegistry.set(funcName, {
              params: path.node.params as t.Identifier[],
              body: path.node.body
            })
            path.remove()
          }
        }
      })

      // 2. USAGE VALIDATION & TRANSFORMATION
      traverse(ast, {
        CallExpression(path) {
          const funcData = getInlineTarget(path)
          if (!funcData) return

          const callee = path.node.callee as t.Identifier
          const funcName = callee.name

          const unsafeParent = path.findParent((p) => p.isLogicalExpression() || p.isConditionalExpression())
          if (unsafeParent) {
            reportError(`Cannot inline function '${funcName}': used in short-circuiting expression.`, path.node)
            throw new Error(`[unplugin-inline] Usage Error:\n${errors.join('\n')}`)
          }

          const resultId = path.scope.generateUidIdentifier(`${funcName}Result`)
          const labelId = path.scope.generateUidIdentifier(`${funcName}Label`)
          const paramMap = new Map<string, t.Identifier>()

          const argDecls = funcData.params.map((param, i) => {
            const argNode = path.node.arguments[i] || t.identifier('undefined')
            const newParamId = path.scope.generateUidIdentifier(param.name)
            paramMap.set(param.name, newParamId)
            const cloned = t.cloneNode(argNode as t.Expression)
            const declarator = t.variableDeclarator(newParamId, cloned)
            return t.variableDeclaration('const', [
              declarator
            ])
          })

          const tempProgram = t.program([
            t.blockStatement(funcData.body.body.map((n) => t.cloneNode(n)))
          ])
          const tempFile = t.file(tempProgram, [], [])

          traverse(tempFile, {
            Identifier(idPath) {
              const name = idPath.node.name
              if (paramMap.has(name) && idPath.isReferencedIdentifier() && !idPath.scope.hasBinding(name)) {
                idPath.replaceWith(paramMap.get(name)!)
              }
            },
            VariableDeclarator(varPath) {
              if (t.isIdentifier(varPath.node.id)) {
                const oldName = varPath.node.id.name
                const newId = path.scope.generateUidIdentifier(oldName)
                varPath.scope.rename(oldName, newId.name)
              }
            }
          })

          const transformedBody = (tempProgram.body[0] as t.BlockStatement).body
          const labeledBlock = t.labeledStatement(labelId, t.blockStatement([
            ...argDecls,
            ...transformedBody
          ]))
          const resultDecl = t.variableDeclaration('let', [
            t.variableDeclarator(resultId)
          ])

          const parentStmt = path.getStatementParent()
          if (parentStmt) {
            const inserted = parentStmt.insertBefore([
              resultDecl,
              labeledBlock
            ])
            const labeledStmtPath = inserted[1]

            labeledStmtPath.traverse({
              ReturnStatement(returnPath) {
                const val = returnPath.node.argument || t.identifier('undefined')
                const assign = t.expressionStatement(t.assignmentExpression('=', resultId, val))
                const breakStmt = t.breakStatement(labelId)

                if (Array.isArray(returnPath.container)) {
                  returnPath.replaceWithMultiple([
                    assign,
                    breakStmt
                  ])
                } else {
                  returnPath.replaceWith(t.blockStatement([
                    assign,
                    breakStmt
                  ]))
                }
              },
              Function(childPath) {
                childPath.skip()
              }
            })

            path.replaceWith(resultId)
          }
        }
      })

      if (errors.length > 0) {
        throw new Error(`[unplugin-inline] Validation failed:\n${errors.join('\n')}`)
      }

      return generate(ast, {
        sourceMaps: true
      }, code)
    }
  }
})

export const vitePlugin = inlinePlugin.vite
export const rollupPlugin = inlinePlugin.rollup
export const esbuildPlugin = inlinePlugin.esbuild
export const webpackPlugin = inlinePlugin.webpack
export default inlinePlugin