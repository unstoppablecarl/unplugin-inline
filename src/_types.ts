import * as t from '@babel/types'

export type InlineTarget = {
  params: t.Identifier[]
  body: t.BlockStatement
}

export type FileResolver = (source: string, importer: string) => Promise<string | null>

export interface ResolvedImport {
  sourcePath: string
  originalName: string
}

export interface InlinePluginOptions {
  inlineIdentifier: string
  allowedGlobals: string[]
  variableNamePrefix: string
}