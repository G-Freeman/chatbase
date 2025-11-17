import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
	root: __dirname,
	publicDir: path.resolve(__dirname, 'public'),
	server: {
		host: true,
		port: 4173,
	},
	build: {
		outDir: path.resolve(__dirname, 'dist'),
		emptyOutDir: true,
	},
});
