import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // parallel agents' worktrees live under .claude/worktrees: never run their copies of the tests
  test: { exclude: [...configDefaults.exclude, '.claude/**', '.superpowers/**'] },
  server: { proxy: { '/api/voice': { target: 'ws://localhost:8787', ws: true, rewrite: () => '/' } } },
})
