import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['main/**/*.test.ts', 'shared/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@main': resolve(__dirname, 'main'),
    },
  },
})
