import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Online play: the game server (server/, port 8787) handles /ws. In production it's the same host.
    // Sign-in (/auth) and the account API (/api) are the game server's too.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/auth': 'http://localhost:8787', '/api': 'http://localhost:8787' },
  },
})
