import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    tailwindcss(),
    react(),
    basicSsl(),
  ],
  server: {
    host: 'localconsole.staminads.com',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localapi.staminads.com:3000',
        changeOrigin: true,
      },
    },
  },
})
