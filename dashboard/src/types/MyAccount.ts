export type MyAccountUsagePoint = {
	date: string;
	used_traffic: number;
};

export type MyAccountNodeUsage = {
	node_id?: number | null;
	node_name: string;
	used_traffic: number;
};

export type MyAccountTrafficBasis = "used_traffic" | "created_traffic";

export type MyAccountServiceLimit = {
	service_id: number;
	service_name: string;
	traffic_basis: MyAccountTrafficBasis;
	data_limit: number | null;
	used_traffic: number;
	remaining_data: number | null;
	users_limit: number | null;
	current_users_count: number;
	remaining_users: number | null;
	daily_usage: MyAccountUsagePoint[];
};

export type MyAccountResponse = {
	traffic_basis: MyAccountTrafficBasis;
	use_service_traffic_limits: boolean;
	data_limit: number | null;
	used_traffic: number;
	remaining_data: number | null;
	users_limit: number | null;
	current_users_count: number;
	remaining_users: number | null;
	daily_usage: MyAccountUsagePoint[];
	node_usages: MyAccountNodeUsage[];
	service_limits: MyAccountServiceLimit[];
};
