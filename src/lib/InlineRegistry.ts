import { normalizePath } from 'vite'
import type { InlineTarget } from '../_types'

export type InlineRegistry = ReturnType<typeof makeInlineRegistry>
export type FunctionName = string
export type FilePath = string

export function makeInlineRegistry() {
  const registry = new Map<FilePath, Map<FunctionName, InlineTarget>>()

  return {
    set(file: string, functionName: string, target: InlineTarget) {
      const path = normalizePath(file)
      if (!registry.has(path)) {
        registry.set(path, new Map())
      }
      registry.get(path)!.set(functionName, target)
    },

    get(file: string, functionName: string): InlineTarget | undefined {
      const path = normalizePath(file)
      return registry.get(path)?.get(functionName)
    },

    has(file: string, functionName: string): boolean {
      const path = normalizePath(file)
      return !!registry.get(path)?.has(functionName)
    },

    delete(file: string, functionName: string) {
      const path = normalizePath(file)
      registry.get(path)?.delete(functionName)
    },

    clearFile(file: string) {
      const path = normalizePath(file)
      registry.delete(path)
    },
  }
}
