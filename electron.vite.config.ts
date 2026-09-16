import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'MYREPOS_')

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        __MYREPOS_GITHUB_CLIENT_ID__: JSON.stringify(env.MYREPOS_GITHUB_CLIENT_ID ?? ''),
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },
        },
      },
    },
    renderer: {
      server: {
        port: 7000,
        strictPort: true,
      },
      preview: {
        port: 7000,
        strictPort: true,
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
        },
      },
      plugins: [react()],
    },
  }
})
