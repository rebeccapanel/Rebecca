export type AdminApiKey = {
	id: number;
	created_at: string;
	expires_at: string | null;
	last_used_at: string | null;
	masked_key?: string | null;
	api_key?: string | null; // only on creation response
};
