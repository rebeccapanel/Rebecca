export type AccessInsightPlatform = {
	platform: string;
	connections: number;
	destinations: string[];
};

export type AccessInsightClient = {
	user_key: string;
	user_label: string;
	last_seen: string;
	route: string;
	connections: number;
	sources?: string[];
	operators?: { ip: string; short_name?: string; owner?: string }[];
	operator_counts?: Record<string, number>;
	platforms: AccessInsightPlatform[];
};

export type AccessInsightUnmatched = {
	destination: string;
	destination_ip?: string | null;
	platform?: string;
};

export type AccessInsightsResponse = {
	log_path: string;
	geo_assets_path: string;
	geo_assets: {
		geosite: boolean;
		geoip: boolean;
	};
	platforms?: { platform: string; count: number; percent?: number }[];
	matched_entries?: number;
	error?: string;
	detail?: string;
	window_seconds?: number;
	items: AccessInsightClient[];
	platform_counts: Record<string, number>;
	generated_at: string;
	lookback_lines: number;
	unmatched?: AccessInsightUnmatched[];
};



