export type MatcherKind = "domain" | "ip" | "process";

export type MatcherOption = {
	value: string;
	hint: string;
};

const GEOSITE_CATEGORIES: MatcherOption[] = [
	{ value: "category-ads", hint: "common advertising domains" },
	{ value: "category-ads-all", hint: "advertising domains and their trackers" },
	{ value: "category-ai-!cn", hint: "AI services outside mainland China" },
	{ value: "category-ai-cn", hint: "AI services in mainland China" },
	{ value: "cn", hint: "geolocation-cn and tld-cn" },
	{ value: "apple", hint: "Apple domains" },
	{ value: "google", hint: "Google domains" },
	{ value: "google@cn", hint: "Google domains with the cn attribute" },
	{ value: "microsoft", hint: "Microsoft domains" },
	{ value: "facebook", hint: "Facebook domains" },
	{ value: "twitter", hint: "Twitter domains" },
	{ value: "telegram", hint: "Telegram domains" },
	{ value: "geolocation-cn", hint: "common mainland China sites" },
	{ value: "geolocation-!cn", hint: "common sites outside mainland China" },
	{ value: "tld-cn", hint: "top-level domains used in mainland China" },
	{ value: "tld-!cn", hint: "top-level domains not used in mainland China" },
];

const GEOIP_CODES: MatcherOption[] = [
	{ value: "cn", hint: "IPs of mainland China" },
	{ value: "private", hint: "private and loopback addresses" },
];

const DOMAIN_PREFIXES: MatcherOption[] = [
	{ value: "domain:", hint: "the domain and its subdomains" },
	{ value: "full:", hint: "exactly this domain" },
	{ value: "keyword:", hint: "any domain containing this text" },
	{ value: "regexp:", hint: "regular expression" },
	{ value: "geosite:", hint: "predefined domain list" },
	{ value: "ext:", hint: "load from file, ext:file:tag" },
];

const IP_PREFIXES: MatcherOption[] = [
	{ value: "geoip:", hint: "predefined IP list" },
	{ value: "!geoip:", hint: "everything outside a predefined IP list" },
	{ value: "ext:", hint: "load from file, ext:file:tag" },
	{ value: "0.0.0.0/0", hint: "all IPv4 addresses" },
	{ value: "::/0", hint: "all IPv6 addresses" },
];

const PROCESS_MATCHERS: MatcherOption[] = [
	{ value: "self/", hint: "the Xray process itself, avoids routing loops" },
	{ value: "xray/", hint: "every process started from this Xray binary" },
];

const MATCHER_PREFIXES = new Set([
	"domain:",
	"full:",
	"keyword:",
	"regexp:",
	"geosite:",
	"ext:",
	"geoip:",
	"!geoip:",
]);

export const isMatcherPrefix = (value: string) => MATCHER_PREFIXES.has(value);

const prefixed = (prefix: string, items: MatcherOption[]): MatcherOption[] =>
	items.map((item) => ({ value: `${prefix}${item.value}`, hint: item.hint }));

export const matcherOptions = (kind: MatcherKind): MatcherOption[] => {
	if (kind === "process") return PROCESS_MATCHERS;
	if (kind === "domain") {
		return [...DOMAIN_PREFIXES, ...prefixed("geosite:", GEOSITE_CATEGORIES)];
	}
	return [
		...IP_PREFIXES,
		...prefixed("geoip:", GEOIP_CODES),
		...prefixed("!geoip:", GEOIP_CODES),
	];
};
