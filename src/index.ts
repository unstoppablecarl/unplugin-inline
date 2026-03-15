import { inlinePlugin } from './inline-plugin'

export type { InlinePluginOptions } from './_types'

export * from './defaults'

export const vitePlugin = inlinePlugin.vite
export const rollupPlugin = inlinePlugin.rollup
export const esbuildPlugin = inlinePlugin.esbuild
export const webpackPlugin = inlinePlugin.webpack
export default inlinePlugin