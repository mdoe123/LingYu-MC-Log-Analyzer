import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: resolve('test/run.ts'),
    outDir: 'test-dist',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'run.cjs'
      }
    }
  }
})
