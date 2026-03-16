import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { InlineCandidate, InlinePluginOptions } from '../_types'
import { makeErrorManager } from './ErrorManager'
import { executeInlining } from './executeInlining'
import type { InlineRegistry } from './InlineRegistry'

const traverse = ((_traverse as any).default || _traverse) as typeof _traverse

export function flattenInlinedFunctions(
  id: string,
  opts: InlinePluginOptions,
  candidatesInFile: InlineCandidate[],
  inlineRegistry: InlineRegistry,
): void {
  // getSortedOrder now throws a validation error if a cycle is found
  const sortedNames = getSortedOrder(id, candidatesInFile)

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
    const tempFile = t.file(t.program([...t.cloneNode(target.body).body]))

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
  id: string,
  candidatesInFile: InlineCandidate[],
): string[] {
  const candidateMap = new Map<string, InlineCandidate>(
    candidatesInFile.map(c => [c.normalizedName, c]),
  )

  const visited = new Set<string>()
  const recStack = new Set<string>()
  const result: string[] = []

  // Pre-calculate dependencies
  const adj = new Map<string, Set<string>>()
  for (const candidate of candidatesInFile) {
    adj.set(candidate.normalizedName, getLocalDependencies(candidate.normalizedBody, new Set(candidateMap.keys())))
  }

  function visit(name: string) {
    const candidate = candidateMap.get(name)
    if (!candidate) return

    if (recStack.has(name)) {
      const stackArr = [...recStack]
      const cycleStart = stackArr.indexOf(name)
      const cyclePath = [...stackArr.slice(cycleStart), name].join(' -> ')

      const err = makeErrorManager(id)
      // We pass the actual AST node of the function declaration to the error manager
      err.recordError(
        `Circular dependency detected in @__INLINE__ functions: ${cyclePath}`,
        candidate.nodePath.node,
      )
      throw err.makeUsageError()
    }

    if (visited.has(name)) return

    recStack.add(name)
    const deps = adj.get(name)
    if (deps) {
      for (const dep of deps) {
        visit(dep)
      }
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
