import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('./web', import.meta.url))

export default defineConfig({
  root: web,
  plugins: [tailwindcss()],
  resolve: { alias: { '@': web } },
})
