import { fetch } from "service/http";
import { create } from "zustand";

export type HostsSchema = Record<
	string,
	{
		id?: number | null;
		remark: string;
		address: string;
		dns_primary: string;
		dns_secondary: string;
		address_options?: string[];
		address_selection_mode?: string;
		address_ttl_seconds?: number | null;
		port: number | null;
		path: string | null;
		sni: string | null;
		sni_options?: string[];
		sni_selection_mode?: string;
		sni_ttl_seconds?: number | null;
		host: string | null;
		host_options?: string[];
		host_selection_mode?: string;
		host_ttl_seconds?: number | null;
		mux_enable: boolean | null;
		allowinsecure: boolean | null;
		is_disabled: boolean;
		fragment_setting: string | null;
		noise_setting: string | null;
		finalmask: Record<string, unknown> | null;
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
	fetchHosts: () => Promise<void>;
	setHosts: (hosts: Partial<HostsSchema>) => Promise<void>;
	setHostStatus: (hostId: number, isDisabled: boolean) => Promise<void>;
};
let hostsFetchSequence = 0;

export const useHosts = create<HostsStore>((set) => ({
	isLoading: false,
	isPostLoading: false,
	hosts: {},
	async fetchHosts() {
		const requestId = ++hostsFetchSequence;
		set({ isLoading: true });
		try {
			const hosts = await fetch<HostsSchema>("/hosts");
			if (requestId !== hostsFetchSequence) return;
			// Ensure hosts is always an object, even if API returns null/undefined
			set({ hosts: hosts || {} });
		} catch (error) {
			if (requestId !== hostsFetchSequence) return;
			console.error("Failed to fetch hosts:", error);
			set({ hosts: {} });
		} finally {
			if (requestId === hostsFetchSequence) {
				set({ isLoading: false });
			}
		}
	},
	setHosts: (body) => {
		set({ isPostLoading: true });
		return fetch("/hosts", { method: "PUT", body }).finally(() => {
			set({ isPostLoading: false });
		});
	},
	setHostStatus: (hostId, isDisabled) => {
		set({ isPostLoading: true });
		return fetch(`/hosts/${hostId}/status`, {
			method: "PUT",
			body: { is_disabled: isDisabled },
		}).finally(() => {
			set({ isPostLoading: false });
		});
	},
}));

export const clearHostsCache = () => {
	hostsFetchSequence += 1;
	useHosts.setState({
		isLoading: false,
		isPostLoading: false,
		hosts: {},
	});
};
