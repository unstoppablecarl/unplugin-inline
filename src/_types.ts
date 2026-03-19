import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

export type InlineTarget = {
  params: t.Identifier[]
  body: t.BlockStatement
  type: InlineCandidateType
}

export type FileResolver = (source: string, importer: string) => Promise<string | null>

export interface ResolvedImport {
  sourcePath: string
  originalName: string
}

export interface InlinePluginOptions {
  inlineIdentifier: string
  inlineMacroIdentifier: string,
  allowedGlobals: string[]
  variableNamePrefix: string
  fileExtensions: string[]
  autoConvertInlineToMacro: boolean
}

export type InlineCandidate = {
  type: InlineCandidateType,
  normalizedName: string
  normalizedBody: t.BlockStatement
  nodePath: NodePath<t.FunctionDeclaration | t.VariableDeclarator>
  localDependencies: Set<string>
}

export enum InlineCandidateType {
  NONE,
  INLINE,
  MACRO
}