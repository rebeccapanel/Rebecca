export type AdvancedFilterOption = {
	key: string;
	labelKey: string;
	fallback: string;
};

export const ADVANCED_FILTER_OPTIONS: AdvancedFilterOption[] = [
	{
		key: "top_speed",
		labelKey: "filters.advanced.topSpeed",
		fallback: "Highest live speed",
	},
	{
		key: "online",
		labelKey: "filters.advanced.online",
		fallback: "Online right now",
	},
	{
		key: "offline",
		labelKey: "filters.advanced.offline",
		fallback: "Offline for 24h",
	},
	{
		key: "sub_not_updated",
		labelKey: "filters.advanced.subNotUpdated",
		fallback: "Sub link stale for 24h",
	},
	{
		key: "sub_never_updated",
		labelKey: "filters.advanced.subNeverUpdated",
		fallback: "Sub link never updated",
	},
	{
		key: "limit",
		labelKey: "filters.advanced.limit",
		fallback: "Has data limit",
	},
	{
		key: "unlimited",
		labelKey: "filters.advanced.unlimited",
		fallback: "Unlimited users",
	},
	{
		key: "finished",
		labelKey: "filters.advanced.finished",
		fallback: "Finished (limited or expired)",
	},
	{
		key: "expired",
		labelKey: "filters.advanced.statusExpired",
		fallback: "Expired users",
	},
	{
		key: "limited",
		labelKey: "filters.advanced.statusLimited",
		fallback: "Limited users",
	},
	{
		key: "disabled",
		labelKey: "filters.advanced.statusDisabled",
		fallback: "Disabled users",
	},
	{
		key: "on_hold",
		labelKey: "filters.advanced.statusOnHold",
		fallback: "On-hold users",
	},
];
