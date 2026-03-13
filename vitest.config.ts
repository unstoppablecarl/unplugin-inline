import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcovonly', 'html'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // Usually just exports, not much to test
        '**/*.test.ts',
        '**/*.d.ts'
      ],
    },
  },
})
