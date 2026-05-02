import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  base: '/photo-trade-maker/',
  css: {
    postcss: './postcss.config.js',
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
