import { normalize } from 'node:path'

export const normalizePath = (file: string) => normalize(file).replace(/\\/g, '/')
