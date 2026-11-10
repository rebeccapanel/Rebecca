import { fetch as apiFetch } from "./http";

export type MyHost = {
	id: number;
	remark: string;
	default_remark: string;
	inbound_tag: string;
	address: string;
	enabled: boolean;
	customized: boolean;
};

export type MyHostsService = {
	id: number;
	name: string;
	host_ids: number[];
	default_host_ids: number[];
	customized: boolean;
};

export type MyHostsResponse = {
	active: boolean;
	hosts: MyHost[];
	services: MyHostsService[];
};

export type MyHostsUpdate = {
	hosts: Array<{ id: number; remark: string; enabled: boolean }>;
	orders: Array<{ service_id: number; host_ids: number[] }>;
};

export const getMyHosts = async () => apiFetch<MyHostsResponse>("/myhosts");

export const saveMyHosts = async (payload: MyHostsUpdate) =>
	apiFetch<MyHostsResponse>("/myhosts", {
		method: "PUT",
		body: JSON.stringify(payload),
	});

export const resetMyHosts = async () =>
	apiFetch<MyHostsResponse>("/myhosts", { method: "DELETE" });
