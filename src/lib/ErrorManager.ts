import * as t from '@babel/types'

export const ERROR_PREFIX = '[unplugin-inline]'
export type ErrorManager = ReturnType<typeof makeErrorManager>

export function makeErrorManager(id: string) {
  const errors: string[] = []

  const recordError = (message: string, node?: t.Node) => {
    const loc = node?.loc
    let locationString = id

    if (loc) {
      const line = loc.start.line
      const col = loc.start.column
      locationString = `${id}:${line}:${col}`
    }

    const fullMessage = `${locationString} - ${message}`
    errors.push(fullMessage)
  }

  function hasValidationErrors() {
    return errors.length > 0
  }

  function reportValidationErrors() {
    return new Error(`${ERROR_PREFIX} Validation failed:\n${errors.join('\n')}`)
  }

  function makeValidationError(message: string, node?: t.Node) {
    recordError(message, node)
    return new Error(`${ERROR_PREFIX} Validation failed:\n${errors.join('\n')}`)
  }

  function makeUsageError(message: string, node?: t.Node) {
    recordError(message, node)
    return new Error(`${ERROR_PREFIX} Usage Error:\n${errors.join('\n')}`)
  }

  function makeInternalError(message: string, node?: t.Node) {
    recordError(message, node)
    return new Error(`${ERROR_PREFIX} Internal Error:\n${errors.join('\n')}`)
  }

  return {
    errors,
    recordError,
    reportValidationErrors,
    makeUsageError,
    makeInternalError,
    makeValidationError,
    hasValidationErrors,
  }
}