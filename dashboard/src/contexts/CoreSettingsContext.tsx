import { fetch } from "service/http";
import { type CoreConfig, parseCoreConfig } from "utils/coreConfig";
import { create } from "zustand";

let coreFetchSequence = 0;
let coreFetchAbortController: AbortController | null = null;

export type CoreConfigTarget = {
	id: string;
	type: "master" | "node";
	name: string;
	address?: string;
	node_id: number | null;
	mode: "default" | "custom";
	status?: string | null;
};

type CoreSettingsStore = {
	loading: boolean;
	isPostLoading: boolean;
	fetchCoreSettings: (target?: string) => Promise<void>;
	fetchConfigTargets: () => Promise<CoreConfigTarget[]>;
	updateConfig: (json: CoreConfig, target?: string) => Promise<void>;
	updateConfigTargetMode: (
		nodeId: number,
		mode: "default" | "custom",
	) => Promise<void>;
	restartCore: (target?: string) => Promise<void>;
	version: string | null;
	started: boolean | null;
	logs_websocket: string | null;
	runtimeLoaded: boolean;
	configTargets: CoreConfigTarget[];
	config: CoreConfig | null;
};

export const useCoreSettings = create<CoreSettingsStore>((set, get) => ({
	loading: true,
	isPostLoading: false,
	version: null,
	started: false,
	logs_websocket: null,
	runtimeLoaded: false,
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
		const requestId = ++coreFetchSequence;
		coreFetchAbortController?.abort();
		const abortController = new AbortController();
		coreFetchAbortController = abortController;
		set({ loading: true });
		try {
			const [core, config] = await Promise.all([
				get().runtimeLoaded
					? Promise.resolve(null)
					: fetch<{
							version: string | null;
							started: boolean | null;
							logs_websocket: string | null;
						}>("/core", { signal: abortController.signal }),
				fetch<unknown>("/core/config", {
					query: { target },
					signal: abortController.signal,
				}),
			]);
			if (requestId !== coreFetchSequence || abortController.signal.aborted)
				return;
			set({
				...(core
					? {
							version: core.version,
							started: core.started,
							logs_websocket: core.logs_websocket,
							runtimeLoaded: true,
						}
					: {}),
				config: parseCoreConfig(config),
			});
		} catch (error) {
			if (requestId !== coreFetchSequence || abortController.signal.aborted)
				return;
			console.error("Error fetching core settings:", error);
			throw error;
		} finally {
			if (requestId === coreFetchSequence) {
				if (coreFetchAbortController === abortController) {
					coreFetchAbortController = null;
				}
				set({ loading: false });
			}
		}
	},
	updateConfig: (body, target = "master") => {
		set({ isPostLoading: true });
		return fetch<unknown>("/core/config", {
			method: "PUT",
			query: { target },
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
		})
			.then(parseCoreConfig)
			.then(() => undefined)
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
