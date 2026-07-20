import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@opengsd/rpc-client', '@opengsd/contracts'] })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@main': resolve(__dirname, 'main'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'preload/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@renderer': resolve(__dirname, 'renderer'),
      },
    },
    plugins: [react()],
  },
})
