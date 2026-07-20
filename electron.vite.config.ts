import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@common': resolve('src/common')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@common': resolve('src/common')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@common': resolve('src/common')
      }
    },
    // gray-matter's js-yaml dependency references the bare Node `global`
    // identifier (not `globalThis`), which doesn't exist in a browser
    // bundle otherwise. Buffer/process themselves are polyfilled at
    // runtime via nodePolyfills.ts (imported first in main.tsx).
    define: {
      global: 'globalThis'
    },
    plugins: [react()]
  }
})
