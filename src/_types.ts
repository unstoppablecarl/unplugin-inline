import * as t from '@babel/types'

export type InlineTarget = {
  params: t.Identifier[]
  body: t.BlockStatement
}

export type Resolver = (source: string, importer: string) => Promise<string | null>