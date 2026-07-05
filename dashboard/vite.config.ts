import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv, splitVendorChunkPlugin } from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

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
