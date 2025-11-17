import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
    publicDir: 'public',
    plugins: [react()],
    css: { postcss: './postcss.config.cjs' },
    build: { copyPublicDir: true },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
})
