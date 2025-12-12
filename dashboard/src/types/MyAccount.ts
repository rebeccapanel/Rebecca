export type MyAccountUsagePoint = {
	date: string;
	used_traffic: number;
};

export type MyAccountNodeUsage = {
	node_id?: number | null;
	node_name: string;
	used_traffic: number;
};

export type MyAccountResponse = {
	data_limit: number | null;
	used_traffic: number;
	remaining_data: number | null;
	users_limit: number | null;
	current_users_count: number;
	remaining_users: number | null;
	daily_usage: MyAccountUsagePoint[];
	node_usages: MyAccountNodeUsage[];
};
