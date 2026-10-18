import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: webRoot,
	plugins: [react()],
	publicDir: path.resolve(webRoot, "../public"),
	resolve: {
		alias: {
			"@web": path.resolve(webRoot, "src"),
			"@": path.resolve(webRoot, "../src"),
		},
	},
	server: { host: "127.0.0.1", port: 4174, strictPort: true },
	build: { outDir: path.resolve(webRoot, "dist"), emptyOutDir: true },
});