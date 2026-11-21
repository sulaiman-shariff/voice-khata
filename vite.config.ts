import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    proxy: {
      '/api/voice': { target: 'ws://localhost:8787', ws: true, rewrite: () => '/' },
      // HTTP functions (reminders, backup, confirm links) are served by `npm run server` too
      '/api': { target: 'http://localhost:8787' },
    },
  },
})
