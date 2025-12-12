import { fetch } from "service/http";
import { create } from "zustand";

export type HostsSchema = Record<
	string,
	{
		id?: number | null;
		remark: string;
		address: string;
		sort: number | null;
		port: number | null;
		path: string | null;
		sni: string | null;
		host: string | null;
		mux_enable: boolean | null;
		allowinsecure: boolean | null;
		is_disabled: boolean;
		fragment_setting: string | null;
		noise_setting: string | null;
		random_user_agent: boolean | null;
		security: string;
		alpn: string;
		fingerprint: string;
		use_sni_as_host: boolean | null;
	}[]
>;

type HostsStore = {
	isLoading: boolean;
	isPostLoading: boolean;
	hosts: HostsSchema;
	fetchHosts: () => void;
	setHosts: (hosts: Partial<HostsSchema>) => Promise<void>;
};
export const useHosts = create<HostsStore>((set) => ({
	isLoading: false,
	isPostLoading: false,
	hosts: {},
	fetchHosts: () => {
		set({ isLoading: true });
		fetch("/hosts")
			.then((hosts) => {
				// Ensure hosts is always an object, even if API returns null/undefined
				set({ hosts: hosts || {} });
			})
			.catch((error) => {
				console.error("Failed to fetch hosts:", error);
				set({ hosts: {} });
			})
			.finally(() => set({ isLoading: false }));
	},
	setHosts: (body) => {
		set({ isPostLoading: true });
		return fetch("/hosts", { method: "PUT", body }).finally(() => {
			set({ isPostLoading: false });
		});
	},
}));
