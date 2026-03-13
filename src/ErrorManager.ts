import * as t from '@babel/types'

export function makeErrorManager(id: string) {
  const errors: string[] = []

  const recordError = (message: string, node: t.Node) => {
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

  function makeValidationError() {
    if (errors.length > 0) {
      return new Error(`[unplugin-inline] Validation failed:\n${errors.join('\n')}`)
    }
  }

  function makeUsageError() {
    return new Error(`[unplugin-inline] Usage Error:\n${errors.join('\n')}`)
  }

  return {
    errors,
    recordError,
    makeValidationError,
    makeUsageError
  }
}