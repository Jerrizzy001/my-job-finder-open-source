import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev` proxies the API to a running `jobfinder serve` on 4321.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:4321', headers: { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' } },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
})
