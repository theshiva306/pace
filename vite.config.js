import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the built assets work no matter what subpath GitHub
// Pages serves the repo from (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
