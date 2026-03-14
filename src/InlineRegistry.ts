import { normalize } from 'node:path'
import type { InlineTarget } from './_types'

export type InlineRegistry = ReturnType<typeof makeInlineRegistry>

export function makeInlineRegistry() {

  const registry = new Map<string, InlineTarget>

  return {
    set(file: string, functionName: string, target: InlineTarget) {
      const key = toKey(file, functionName)
      registry.set(key, target)

    },
    get(file: string, functionName: string): InlineTarget | undefined {
      const key = toKey(file, functionName)
      return registry.get(key)
    },
  }
}

const toKey = (file: string, functionName: string) => {
  // Normalize paths to prevent "C:\file" vs "/file" mismatches
  return `${normalize(file)}#${functionName}`
}