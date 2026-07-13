import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import {
	defineConfig,
	loadEnv,
	type Plugin,
	splitVendorChunkPlugin,
} from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

const tutorialDirectoryIndex = {
	name: "tutorial-directory-index",
	configureServer(server) {
		server.middlewares.use((request, _response, next) => {
			const url = new URL(request.url || "/", "http://localhost");
			if (
				url.pathname.startsWith("/tutorial-content/") &&
				url.pathname.endsWith("/")
			) {
				request.url = `${url.pathname}index.html${url.search}`;
			}
			next();
		});
	},
} satisfies Plugin;

const getApiProxyConfig = (baseAPI?: string) => {
	if (!baseAPI || !/^https?:\/\//i.test(baseAPI)) {
		return undefined;
	}

	try {
		const parsed = new URL(baseAPI);
		const proxyPath =
			parsed.pathname && parsed.pathname !== "/"
				? parsed.pathname.replace(/\/$/, "")
				: "/api";
		const target = `${parsed.protocol}//${parsed.host}`;
		const rewrite =
			parsed.pathname && parsed.pathname !== "/"
				? undefined
				: (path: string) => path.replace(/^\/api(?=\/|$)/, "");

		return {
			proxyPath,
			options: {
				target,
				changeOrigin: true,
				secure: true,
				rewrite,
			},
		};
	} catch {
		return undefined;
	}
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const apiProxy = getApiProxyConfig(env.VITE_BASE_API);

	return {
		plugins: [
			tutorialDirectoryIndex,
			tsconfigPaths(),
			react({
				include: "**/*.tsx",
			}),
			svgr(),
			visualizer(),
			splitVendorChunkPlugin(),
		],
		server: apiProxy
			? {
					proxy: {
						[apiProxy.proxyPath]: apiProxy.options,
					},
				}
			: undefined,
		build: {
			outDir: "build",
			assetsDir: "statics",
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
	};
});
