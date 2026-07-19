import type { Admin } from "types/Admin";
import { fetch } from "./http";

export type SessionState =
	| "active"
	| "pending_2fa"
	| "setup_required"
	| "disabled";

export type AuthSession = {
	state: SessionState;
	admin: Admin;
	permissions_version: string;
	totp_enabled: boolean;
	require_2fa: boolean;
};

export type TOTPSetup = { secret: string; uri: string };
export type AdminSessionView = {
	id: number;
	created_at: string;
	last_seen_at: string;
	expires_at: string;
	ip_address: string;
	user_agent: string;
	current?: boolean;
};

export const login = (username: string, password: string) =>
	fetch<AuthSession>("/auth/login", {
		method: "POST",
		body: { username, password },
	});

export const getSession = () => fetch<AuthSession>("/auth/session");

export const logout = () => fetch<void>("/auth/logout", { method: "POST" });

export const verify2FA = (code: string) =>
	fetch<AuthSession>("/auth/2fa/verify", { method: "POST", body: { code } });

export const start2FASetup = () =>
	fetch<TOTPSetup>("/auth/2fa/setup", { method: "POST" });

export const confirm2FASetup = (code: string) =>
	fetch<AuthSession>("/auth/2fa/confirm", { method: "POST", body: { code } });

export const listSessions = async () => {
	const response = await fetch<{ sessions: AdminSessionView[] }>(
		"/auth/sessions",
	);
	return response.sessions;
};

export const revokeSession = (id: number) =>
	fetch<void>(`/auth/sessions/${id}`, { method: "DELETE" });

export const disable2FA = (password: string, code: string) =>
	fetch<AuthSession>("/auth/2fa", {
		method: "DELETE",
		body: { password, code },
	});

export const listAdminSessions = async (username: string) => {
	const response = await fetch<{ sessions: AdminSessionView[] }>(
		`/admin/${encodeURIComponent(username)}/sessions`,
	);
	return response.sessions;
};

export const revokeAdminSession = (username: string, id: number) =>
	fetch<void>(`/admin/${encodeURIComponent(username)}/sessions/${id}`, {
		method: "DELETE",
	});

export const setupAdmin2FA = (username: string) =>
	fetch<TOTPSetup>(`/admin/${encodeURIComponent(username)}/2fa/setup`, {
		method: "POST",
	});

export const disableAdmin2FA = (username: string) =>
	fetch<void>(`/admin/${encodeURIComponent(username)}/2fa`, {
		method: "DELETE",
	});
