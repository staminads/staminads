import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { APP_VERSION } from '../api/src/version'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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
