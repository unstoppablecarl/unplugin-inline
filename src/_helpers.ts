import { dirname, resolve, extname } from 'node:path'

/**
 * Resolves an import source to an absolute path.
 */
export function resolveSourcePath(source: string, importer: string): string {
  if (!source.startsWith('.')) {
    // If it's a bare import (e.g. 'lodash'), we likely can't inline it
    // without deep node_modules scanning.
    return source
  }

  const absolutePath = resolve(dirname(importer), source)

  // If the import doesn't have an extension, we assume .ts or .js
  if (!extname(absolutePath)) {
    // In a real build, you'd check which file exists,
    // but here we normalize to the target
    return `${absolutePath}.ts`
  }

  return absolutePath
}