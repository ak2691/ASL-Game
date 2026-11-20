import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Online play: the game server (server/, port 8787) handles /ws. In production it's the same host.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
})
