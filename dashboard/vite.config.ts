import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, splitVendorChunkPlugin } from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		tsconfigPaths(),
		react({
			include: "**/*.tsx",
		}),
		svgr(),
		visualizer(),
		splitVendorChunkPlugin(),
	],
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				if (
					typeof warning.message === "string" &&
					warning.message.includes(
						"Module level directives cause errors when bundled",
					)
				) {
					return;
				}
				warn(warning);
			},
		},
	},
});
