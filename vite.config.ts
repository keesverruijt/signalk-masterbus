import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The mapping editor: a small React app built from web/ into public/, which
// Signal K serves at /signalk-masterbus/ (the `signalk-webapp` keyword).
// Relative asset paths, so it works wherever the server mounts it.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true
  }
})
