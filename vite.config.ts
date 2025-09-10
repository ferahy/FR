import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages için base yolu (repo adınızla aynı olmalı)
  base: '/FR/',
})
