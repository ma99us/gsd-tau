import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Standalone renderer config — used by IDE tooling.
// Runtime builds use electron.vite.config.ts.
export default defineConfig({
  root: 'renderer',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'renderer'),
    },
  },
})
