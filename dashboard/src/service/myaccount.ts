import type { AdminApiKey } from "types/ApiKey";
import type { MyAccountResponse } from "types/MyAccount";
import { fetch as apiFetch } from "./http";

export type ChangePasswordPayload = {
	current_password: string;
	new_password: string;
};

export const getMyAccount = async (query?: {
	start?: string;
	end?: string;
}): Promise<MyAccountResponse> => {
	return apiFetch("/myaccount", { query });
};

export const getAdminNodesUsage = async (
	username: string,
	query?: { start?: string; end?: string },
) => {
	return apiFetch(`/admin/${encodeURIComponent(username)}/usage/nodes`, {
		query,
	});
};

export const changeMyAccountPassword = async (
	payload: ChangePasswordPayload,
): Promise<{ detail: string }> => {
	return apiFetch("/myaccount/change_password", {
		method: "POST",
		body: JSON.stringify(payload),
	});
};

export const listApiKeys = async (): Promise<AdminApiKey[]> => {
	return apiFetch("/myaccount/api-keys");
};

export const createApiKey = async (lifetime: string): Promise<AdminApiKey> => {
	return apiFetch("/myaccount/api-keys", {
		method: "POST",
		body: JSON.stringify({ lifetime }),
	});
};

export const deleteApiKey = async (
	id: number,
	current_password: string,
): Promise<void> => {
	return apiFetch(`/myaccount/api-keys/${id}`, {
		method: "DELETE",
		body: JSON.stringify({ current_password }),
	});
};
