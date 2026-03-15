import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { InlineCandidate, InlinePluginOptions } from '../_types'
import { makeErrorManager } from './ErrorManager'
import { executeInlining } from './executeInlining'
import type { InlineRegistry } from './InlineRegistry'

export function flattenInlinedFunctions(
  id: string,
  opts: InlinePluginOptions,
  candidatesInFile: InlineCandidate[],
  inlineRegistry: InlineRegistry,
): void {
  const sortedNames = getSortedOrder(candidatesInFile)

  for (const name of sortedNames) {
    const target = inlineRegistry.get(id, name)

    if (!target || !target.body) {
      const err = makeErrorManager(id)
      err.recordError(
        `Internal Error: Blueprint for '${name}' was not found or is empty.`,
        candidatesInFile.find(({ nodePath }) => {
          const p = nodePath
          return (t.isFunctionDeclaration(p.node) && p.node.id?.name === name) ||
            (t.isVariableDeclarator(p.node) && t.isIdentifier((p.node as any).id) && (p.node as any).id.name === name)
        })?.nodePath?.node, // Safely fall back to undefined if not found
      )
      throw err.makeValidationError()
    }

    // Wrap the blueprint body in a temporary file/program
    // This gives Babel the necessary scope structures to perform renames
    let b0 = target.body
    let b1 = t.cloneNode(b0)
    const tempFile = t.file(t.program([
      ...b1.body,
    ]))

    traverse(tempFile, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee)) return

        const calledName = path.node.callee.name
        const dependency = inlineRegistry.get(id, calledName)

        // If the call is to another inlinable function in the registry, flatten it
        if (dependency) {
          executeInlining(path, opts, dependency)
        }
      },
      Function(p) {
        p.skip()
      },
    })

    // Extract the flattened block back into the registry
    // target.body = (tempFile.program.body[0] as t.BlockStatement)
    target.body = t.blockStatement(tempFile.program.body)
  }
}

export function getSortedOrder(
  candidatesInFile: InlineCandidate[],
): string[] {

  const candidateNames = new Set(candidatesInFile.map(({ normalizedName }) => normalizedName))

  const visited = new Set<string>()
  const result: string[] = []

  // Build a simple adjacency list
  const adj = new Map<string, Set<string>>()
  for (const { normalizedName, normalizedBody } of candidatesInFile) {
    adj.set(normalizedName, getLocalDependencies(normalizedBody, candidateNames))
  }

  function visit(name: string) {
    if (visited.has(name)) return

    const deps = adj.get(name)
    if (deps) {
      for (const dep of deps) {
        // Note: Mutual recursion check is implicit here.
        // If a cycle exists, this would technically infinite loop
        // unless we add a "recStack" check.
        visit(dep)
      }
    }

    visited.add(name)
    result.push(name) // Post-order: add yourself AFTER your dependencies
  }

  for (const name of candidateNames) {
    visit(name)
  }

  return result
}

export function getLocalDependencies(body: t.BlockStatement, candidateNames: Set<string>): Set<string> {
  const deps = new Set<string>()
  traverse(body, {
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee)) {
        const name = path.node.callee.name
        if (candidateNames.has(name)) {
          deps.add(name)
        }
      }
    },
    Function(p) {
      p.skip()
    },
    noScope: true,
  })
  return deps
}