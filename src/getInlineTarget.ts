import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { InlineTarget, Resolver } from './_types'
import type { ErrorManager } from './ErrorManager'
import type { InlineRegistry } from './InlineRegistry'

export async function getInlineTarget(
  inlineIdentifier: string,
  path: NodePath<t.CallExpression>,
  inlineRegistry: InlineRegistry,
  errorManager: ErrorManager,
  currentFile: string,
  resolver: Resolver,
): Promise<InlineTarget | null> {
  const callee = path.node.callee
  if (!t.isIdentifier(callee)) return null
  const funcName = callee.name

  // 1. Check local registry (covers functions in the same file)
  const local = inlineRegistry.get(currentFile, funcName)
  if (local) return local

  // 2. Resolve imports (covers cross-file)
  const binding = path.scope.getBinding(funcName)
  if (binding && (t.isImportSpecifier(binding.path.node) || t.isImportDefaultSpecifier(binding.path.node))) {
    const importDecl = binding.path.parentPath?.node as t.ImportDeclaration
    const resolved = await resolver(importDecl.source.value, currentFile)
    if (resolved) {
      return inlineRegistry.get(resolved, funcName)!
    }
  }

  // 1. REGISTRY CHECK (Priority)
  // Check if this function was already registered from the current file
  // (handles functions removed by findAndValidate in the same pass).
  const localRegistryTarget = inlineRegistry.get(currentFile, funcName)
  if (localRegistryTarget) return localRegistryTarget

  // 2. COMMENT DETECTION
  // Determine if the callsite itself is marked with the @__INLINE__ directive.
  let isLocalInline = false
  let currentSearchPath: NodePath<t.Node> | null = path

  while (currentSearchPath && !currentSearchPath.isProgram()) {
    if (currentSearchPath.node.leadingComments?.some((c) => c.value.includes(inlineIdentifier))) {
      isLocalInline = true
      break
    }
    currentSearchPath = currentSearchPath.parentPath
  }

  // 3. BINDING RESOLUTION
  // If not in registry yet, check the scope to see where it comes from.

  // If there's no binding and it's not in our registry, we can't see the source.
  if (!binding) {
    if (isLocalInline) {
      errorManager.recordError(
        `Cannot inline '${funcName}': No definition found in scope.`,
        path.node,
      )
    }
    return null
  }

  const targetNode = binding.path.node

  // 4. EXTERNAL MODULE RESOLUTION
  // If the function is imported, resolve the source file and check the registry again.
  if (t.isImportSpecifier(targetNode) || t.isImportDefaultSpecifier(targetNode)) {
    const importDecl = binding.path.parentPath?.node as t.ImportDeclaration
    if (importDecl) {
      const resolved = await resolver(importDecl.source.value, currentFile)
      if (resolved) {
        // Strip query params for consistency (Vite/Vue compatibility)
        const sourceFile = resolved.split('?')[0]
        const externalTarget = inlineRegistry.get(sourceFile, funcName)
        if (externalTarget) return externalTarget
      }
    }
  }

  // 5. LOCAL AD-HOC INLINING
  // If the call is marked for inlining but the function wasn't marked at its definition,
  // we try to grab the function body from the local scope.
  if (isLocalInline) {
    if (t.isFunctionDeclaration(targetNode)) {
      return {
        params: targetNode.params as t.Identifier[],
        body: targetNode.body,
      }
    }

    errorManager.recordError(
      `Cannot inline '${funcName}': The target is not a function declaration.`,
      path.node,
    )
  }

  return null
}