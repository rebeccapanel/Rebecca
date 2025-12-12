import { fetch } from "service/http";
import { create } from "zustand";

type CoreSettingsStore = {
	isLoading: boolean;
	isPostLoading: boolean;
	fetchCoreSettings: () => Promise<void>;
	updateConfig: (json: any) => Promise<void>;
	restartCore: () => Promise<void>;
	version: string | null;
	started: boolean | null;
	logs_websocket: string | null;
	config: any;
};

export const useCoreSettings = create<CoreSettingsStore>((set) => ({
	isLoading: true,
	isPostLoading: false,
	version: null,
	started: false,
	logs_websocket: null,
	config: null,
	fetchCoreSettings: async () => {
		set({ isLoading: true });
		try {
			await Promise.all([
				fetch("/core")
					.then(({ version, started, logs_websocket }) => {
						set({ version, started, logs_websocket });
					})
					.catch((error) => {
						console.error("Error fetching /core:", error);
						throw error;
					}),
				fetch("/core/config")
					.then((config) => {
						set({ config });
					})
					.catch((error) => {
						console.error("Error fetching /core/config:", error);
						throw error;
					}),
			]);
		} finally {
			set({ isLoading: false });
		}
	},
	updateConfig: (body) => {
		set({ isPostLoading: true });
		return fetch("/core/config", {
			method: "PUT",
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
		})
			.then((response) => response)
			.catch((error) => {
				console.error("Update error:", error);
				throw error;
			})
			.finally(() => set({ isPostLoading: false }));
	},
	restartCore: () => {
		return fetch("/core/restart", { method: "POST" });
	},
}));
