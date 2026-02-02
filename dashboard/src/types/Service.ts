export type ServiceHost = {
	id: number;
	remark: string;
	inbound_tag: string;
	inbound_protocol: string;
	sort: number;
	address: string;
	port: number | null;
};

export type ServiceAdmin = {
	id: number;
	username: string;
	used_traffic: number;
	lifetime_used_traffic: number;
};

export type ServiceSummary = {
	id: number;
	name: string;
	description: string | null;
	used_traffic: number;
	lifetime_used_traffic: number;
	host_count: number;
	user_count: number;
	has_hosts: boolean;
	broken: boolean;
};

export type ServiceDetail = ServiceSummary & {
	admins: ServiceAdmin[];
	hosts: ServiceHost[];
	admin_ids: number[];
	host_ids: number[];
};

export type ServiceListResponse = {
	services: ServiceSummary[];
	total: number;
};

export type ServiceHostAssignment = {
	host_id: number;
	sort?: number;
};

export type ServiceCreatePayload = {
	name: string;
	description?: string | null;
	admin_ids: number[];
	hosts: ServiceHostAssignment[];
};

export type ServiceModifyPayload = Partial<
	Omit<ServiceCreatePayload, "hosts">
> & {
	hosts?: ServiceHostAssignment[];
};

export type ServiceDeletePayload = {
	mode: "delete_users" | "transfer_users";
	target_service_id?: number | null;
	unlink_admins?: boolean;
};

export type ServiceUsagePoint = {
	timestamp: string;
	used_traffic: number;
};

export type ServiceUsageTimeseries = {
	service_id: number;
	start: string;
	end: string;
	granularity: "day" | "hour";
	points: ServiceUsagePoint[];
};

export type ServiceAdminUsage = {
	admin_id: number | null;
	username: string;
	used_traffic: number;
};

export type ServiceAdminUsageResponse = {
	service_id: number;
	start: string;
	end: string;
	admins: ServiceAdminUsage[];
};

export type ServiceAdminTimeseries = {
	service_id: number;
	admin_id: number | null;
	username: string;
	start: string;
	end: string;
	granularity: "day" | "hour";
	points: ServiceUsagePoint[];
};
