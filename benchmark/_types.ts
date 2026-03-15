export type FilePathString = string

export type BenchProcess = {
  evaluation: () => Promise<void>
  runtime: (args: any[]) => any
}

export type ArgGenerator = () => any

export type CaseCallback = (opts: {
  file: string
  standard: BenchProcess
  inlined: BenchProcess
  args: ArgGenerator[]
}) => void