import { fetch } from "service/http";
import { create } from "zustand";

export type CoreConfigTarget = {
	id: string;
	type: "master" | "node";
	name: string;
	node_id: number | null;
	mode: "default" | "custom";
	status?: string | null;
};

type CoreSettingsStore = {
	isLoading: boolean;
	isPostLoading: boolean;
	fetchCoreSettings: (target?: string) => Promise<void>;
	fetchConfigTargets: () => Promise<CoreConfigTarget[]>;
	updateConfig: (json: any, target?: string) => Promise<void>;
	updateConfigTargetMode: (
		nodeId: number,
		mode: "default" | "custom",
	) => Promise<void>;
	restartCore: (target?: string) => Promise<void>;
	version: string | null;
	started: boolean | null;
	logs_websocket: string | null;
	configTargets: CoreConfigTarget[];
	config: any;
};

export const useCoreSettings = create<CoreSettingsStore>((set) => ({
	isLoading: true,
	isPostLoading: false,
	version: null,
	started: false,
	logs_websocket: null,
	configTargets: [],
	config: null,
	fetchConfigTargets: async () => {
		const response = await fetch<{ targets: CoreConfigTarget[] }>(
			"/core/config/targets",
		);
		const targets = response?.targets || [];
		set({ configTargets: targets });
		return targets;
	},
	fetchCoreSettings: async (target = "master") => {
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
				fetch("/core/config", { query: { target } })
					.then((config) => {
						set({ config });
					})
					.catch((error) => {
						console.error("Error fetching /core/config:", error);
						throw error;
					}),
				fetch<{ targets: CoreConfigTarget[] }>("/core/config/targets").then(
					(response) => set({ configTargets: response?.targets || [] }),
				),
			]);
		} finally {
			set({ isLoading: false });
		}
	},
	updateConfig: (body, target = "master") => {
		set({ isPostLoading: true });
		return fetch("/core/config", {
			method: "PUT",
			query: { target },
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
	updateConfigTargetMode: (nodeId, mode) => {
		return fetch(`/core/config/targets/${nodeId}/mode`, {
			method: "PUT",
			body: { mode },
		});
	},
	restartCore: (target) => {
		return fetch("/core/restart", {
			method: "POST",
			query: target ? { target } : undefined,
		});
	},
}));
