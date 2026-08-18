import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // dersprog.com özel alan adı site KÖKÜNDEN yayınlanıyor (bkz. public/CNAME).
  // '/FR/' yalnızca ferahy.github.io/FR/ alt-yolu için doğruydu; özel alan
  // adında bu prefix, asset yollarının 404 (SPA fallback → yanlış MIME) alıp
  // sayfanın bomboş açılmasına sebep oluyordu.
  base: '/',
})
