import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Backend: cd app && uvicorn src.main:app --reload --port 8000
    proxy: { '/api': (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.API_URL ?? 'http://127.0.0.1:8000' },
  },
})
