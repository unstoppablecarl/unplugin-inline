import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { FileResolver, InlineCandidate, InlinePluginOptions, ResolvedImport } from '../_types'
import { type InlineRegistry } from './InlineRegistry'

export async function findInlineCandidates(
  id: string,
  opts: InlinePluginOptions,
  ast: t.File,
  resolver: FileResolver,
  inlineRegistry: InlineRegistry,
  processImport: (path: string) => Promise<void>,
) {
  const importMap = new Map<string, ResolvedImport>()
  const candidatesInFile: InlineCandidate[] = []

  // PRE-RESOLVE IMPORTS
  // We scan the top-level body for ImportDeclarations
  const importPromises = ast.program.body
    .filter((node): node is t.ImportDeclaration => t.isImportDeclaration(node))
    .map(async (node) => {
      const source = node.source.value
      const resolvedPath = await resolver(source, id)
      // If resolver returns null, we can't track this source.
      if (!resolvedPath) return

      // 1. Immediately parse the imported file and extract its blueprints
      await processImport(resolvedPath)

      node.specifiers.forEach(spec => {
        if (t.isImportSpecifier(spec) || t.isImportDefaultSpecifier(spec)) {
          const importedName = t.isImportSpecifier(spec)
            ? (t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value)
            : 'default'

          importMap.set(spec.local.name, {
            sourcePath: resolvedPath,
            originalName: importedName,
          })
        }
      })
    })

  await Promise.all(importPromises)

  // SCAN & PROVISIONAL REGISTRATION
  traverse(ast, {
    FunctionDeclaration(path) {
      const node = path.node
      const funcName = node.id?.name ?? 'default'

      const isMarked = commentHasDirective(node.leadingComments, opts) ||
        (t.isExportNamedDeclaration(path.parent) && commentHasDirective(path.parent.leadingComments, opts))

      if (isMarked) {

        const body = t.cloneNode(node.body)
        inlineRegistry.set(id, funcName, {
          params: node.params as t.Identifier[],
          body,
        })

        candidatesInFile.push({
          normalizedName: funcName,
          normalizedBody: body,
          nodePath: path,
        })
      }
    },
    //Arrow Functions
    VariableDeclarator(path) {
      const { node } = path
      const arrow = node.init

      if (t.isArrowFunctionExpression(arrow) && t.isIdentifier(node.id)) {
        const funcName = node.id.name
        const parentDeclaration = path.parentPath

        // Check for comment on the 'const/let/var' line
        if (commentHasDirective(parentDeclaration?.node.leadingComments, opts)) {

          // NORMALIZE: Ensure () => x becomes { return x; }
          let body: t.BlockStatement
          if (t.isBlockStatement(arrow.body)) {
            body = t.cloneNode(arrow.body)
          } else {
            body = t.blockStatement([
              t.returnStatement(t.cloneNode(arrow.body)),
            ])
          }

          candidatesInFile.push({
            normalizedName: funcName,
            normalizedBody: body,
            nodePath: path,
          })
          inlineRegistry.set(id, funcName, {
            params: arrow.params as t.Identifier[],
            body,
          })
        }
      }
    },
  })

  return {
    candidatesInFile,
    importMap,
  }
}

export function commentHasDirective(comments: t.Comment[] | null | undefined, opts: InlinePluginOptions): boolean {
  return comments?.some(c => c.value.includes(opts.inlineIdentifier)) ?? false
}