import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { InlineCandidate, InlinePluginOptions } from '../_types'
import { type ErrorManager, makeErrorManager } from './ErrorManager'
import { executeInlining } from './executeInlining'
import type { InlineRegistry } from './InlineRegistry'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse

export function flattenInlinedFunctions(
  id: string,
  opts: InlinePluginOptions,
  candidatesInFile: InlineCandidate[],
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
): void {
  // getSortedOrder now throws a validation error if a cycle is found
  const sortedNames = getSortedOrder(id, candidatesInFile)

  for (const name of sortedNames) {
    const target = inlineRegistry.get(id, name)

    if (!target || !target.body) {
      const err = makeErrorManager(id)
      throw err.makeValidationError(
        `Internal Error: Blueprint for '${name}' was not found or is empty.`,
        candidatesInFile.find(({ nodePath }) => {
          const p = nodePath
          return (t.isFunctionDeclaration(p.node) && p.node.id?.name === name) ||
            (t.isVariableDeclarator(p.node) && t.isIdentifier((p.node as any).id) && (p.node as any).id.name === name)
        })?.nodePath?.node, // Safely fall back to undefined if not found
      )
    }

    // Wrap the blueprint body in a temporary file/program
    // This gives Babel the necessary scope structures to perform renames
    const tempFile = t.file(t.program([...t.cloneNode(target.body).body]))

    traverse(tempFile, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee)) return

        const calledName = path.node.callee.name
        const dependency = inlineRegistry.get(id, calledName)

        // If the call is to another inlinable function in the registry, flatten it
        if (dependency) {
          executeInlining(path, opts, dependency, errorManager)
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
  id: string,
  candidatesInFile: InlineCandidate[],
): string[] {
  const candidateMap = new Map<string, InlineCandidate>(
    candidatesInFile.map(c => [c.normalizedName, c]),
  )

  const visited = new Set<string>()
  const recStack = new Set<string>()
  const result: string[] = []

  function visit(name: string) {
    const candidate = candidateMap.get(name)
    if (!candidate) return

    if (recStack.has(name)) {
      const stackArr = [...recStack]
      const cycleStart = stackArr.indexOf(name)
      const cyclePath = [...stackArr.slice(cycleStart), name].join(' -> ')

      const err = makeErrorManager(id)
      // We pass the actual AST node of the function declaration to the error manager
      throw err.makeUsageError(
        `Circular dependency detected in @__INLINE__ functions: ${cyclePath}`,
        candidate.nodePath.node,
      )
    }

    if (visited.has(name)) return

    recStack.add(name)

    for (const dep of candidate.localDependencies) {
      visit(dep)
    }

    recStack.delete(name)
    visited.add(name)
    result.push(name)
  }

  for (const name of candidateMap.keys()) {
    visit(name)
  }

  return result
}
