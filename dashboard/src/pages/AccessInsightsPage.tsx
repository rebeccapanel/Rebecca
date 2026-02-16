import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	HStack,
	Icon,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	SimpleGrid,
	Spinner,
	Stack,
	Stat,
	StatLabel,
	StatNumber,
	Switch,
	Table,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	ClipboardDocumentIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import useGetUser from "hooks/useGetUser";
import {
	type ElementType,
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { IconType } from "react-icons";
import { FaMicrosoft } from "react-icons/fa";
import { FiGlobe } from "react-icons/fi";
import {
	SiApple,
	SiBinance,
	SiBitcoin,
	SiCloudflare,
	SiFacebook,
	SiGithub,
	SiGoogle,
	SiInstagram,
	SiNetflix,
	SiSamsung,
	SiSnapchat,
	SiSteam,
	SiTelegram,
	SiTiktok,
	SiWhatsapp,
	SiX,
	SiYoutube,
} from "react-icons/si";
import { useQuery } from "react-query";
import { fetch } from "service/http";
import { getPanelSettings } from "service/settings";
import type {
	AccessInsightClient,
	AccessInsightPlatform,
	AccessInsightSource,
	AccessInsightSourceStatus,
	AccessInsightsResponse,
	AccessInsightUnmatched,
} from "types/AccessInsights";
import { getAuthToken } from "utils/authStorage";
import IrancellSvg from "../assets/operators/irancell-svgrepo-com.svg";
import MciSvg from "../assets/operators/mci-svgrepo-com.svg";
import RightelSvg from "../assets/operators/rightel-svgrepo-com.svg";
import TciSvg from "../assets/operators/tci-svgrepo-com.svg";

const REFRESH_INTERVAL = 5000;
const DEFAULT_LIMIT = 250;
const DEFAULT_WINDOW_SECONDS = 120;
const iconAs = (icon: IconType) => icon as unknown as ElementType;

const renderPlatformIcon = (name: string) => {
	const n = name.toLowerCase();
	if (n.includes("telegram")) return <Icon as={iconAs(SiTelegram)} />;
	if (n.includes("instagram")) return <Icon as={iconAs(SiInstagram)} />;
	if (n.includes("facebook")) return <Icon as={iconAs(SiFacebook)} />;
	if (n.includes("whatsapp")) return <Icon as={iconAs(SiWhatsapp)} />;
	if (n.includes("youtube")) return <Icon as={iconAs(SiYoutube)} />;
	if (n.includes("twitter") || n === "x") return <Icon as={iconAs(SiX)} />;
	if (n.includes("tiktok")) return <Icon as={iconAs(SiTiktok)} />;
	if (n.includes("snapchat")) return <Icon as={iconAs(SiSnapchat)} />;
	if (n.includes("google")) return <Icon as={iconAs(SiGoogle)} />;
	if (n.includes("cloudflare")) return <Icon as={iconAs(SiCloudflare)} />;
	if (n.includes("apple") || n.includes("icloud"))
		return <Icon as={iconAs(SiApple)} />;
	if (n.includes("github")) return <Icon as={iconAs(SiGithub)} />;
	if (n.includes("steam")) return <Icon as={iconAs(SiSteam)} />;
	if (n.includes("microsoft") || n.includes("windows"))
		return <Icon as={iconAs(FaMicrosoft)} />;
	if (n.includes("netflix")) return <Icon as={iconAs(SiNetflix)} />;
	if (n.includes("samsung")) return <Icon as={iconAs(SiSamsung)} />;
	if (
		n.includes("porn") ||
		n.includes("xvideo") ||
		n.includes("xhamster") ||
		n.includes("redtube")
	)
		return <Icon as={iconAs(FiGlobe)} />;
	if (
		n.includes("crypto") ||
		n.includes("wallet") ||
		n.includes("binance") ||
		n.includes("trust") ||
		n.includes("btc")
	)
		return n.includes("binance") ? (
			<Icon as={iconAs(SiBinance)} />
		) : (
			<Icon as={iconAs(SiBitcoin)} />
		);
	return <Icon as={iconAs(FiGlobe)} />;
};

const renderOperatorIcon = (name: string) => {
	const n = name.toLowerCase();
	const style = {
		filter: "invert(1) brightness(2)",
		width: "28px",
		height: "28px",
	};
	if (n.includes("mci") || n.includes("hamrah"))
		return <Box as="img" src={MciSvg} style={style} />;
	if (n.includes("irancell") || n.includes("mtn"))
		return <Box as="img" src={IrancellSvg} style={style} />;
	if (n.includes("tci") || n.includes("mokhaberat"))
		return <Box as="img" src={TciSvg} style={style} />;
	if (n.includes("rightel") || n.includes("righ tel") || n.includes("righ-tel"))
		return <Box as="img" src={RightelSvg} style={style} />;
	return <Icon as={iconAs(FiGlobe)} />;
};

const DEFAULT_MAX_LINES = 1000;
const MAX_CLIENTS = 500;
const ACCESS_LINE_RE =
	/^(?<ts>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+from\s+(?:(?<src_prefix>\w+):)?(?<src_ip>[0-9a-fA-F.:]+)(?::(?<src_port>\d+))?\s+(?<action>accepted|rejected)\s+(?:(?<net>\w+):)?(?<dest>[^:\s]+)(?::(?<dest_port>\d+))?(?:\s+\[(?<route>[^\]]+)\])?(?:\s+email:\s+(?<email>\S+))?/i;

type RawLogsChunk = {
	type: "logs";
	node_id: number | null;
	node_name: string;
	lines: string[];
};

type RawMetadataChunk = {
	type: "metadata";
	sources: AccessInsightSource[];
};

type RawSourceStatusChunk = {
	type: "source_status";
	node_id: number | null;
	node_name: string;
	is_master?: boolean;
	connected?: boolean;
	ok: boolean;
	total_lines: number;
	matched_lines: number;
	error?: string;
};

type RawErrorChunk = {
	type: "error";
	node_id?: number | null;
	node_name?: string;
	error: string;
};

type RawCompleteChunk = {
	type: "complete";
};

type RawTopLevelError = {
	error: string;
	detail?: string;
};

type RawStreamChunk =
	| RawLogsChunk
	| RawMetadataChunk
	| RawSourceStatusChunk
	| RawErrorChunk
	| RawCompleteChunk
	| RawTopLevelError;

type ParsedAccessLog = {
	timestampMs: number | null;
	action: string;
	destination: string;
	destinationIp: string | null;
	source: string;
	email: string | null;
	route: string;
	userKey: string;
	userLabel: string;
};

type OperatorLookupItem = {
	ip: string;
	short_name?: string;
	owner?: string;
};

type OperatorLookupResponse = {
	operators?: OperatorLookupItem[];
};

type MutableClient = {
	user_key: string;
	user_label: string;
	lastSeenMs: number;
	route: string;
	connectionEvents: number;
	sources: Set<string>;
	nodes: Set<string>;
	platforms: Map<
		string,
		{ platform: string; connections: number; destinations: Set<string> }
	>;
};

const parseXrayTimestamp = (raw: string): number | null => {
	const [datePart, timePart] = raw.trim().split(/\s+/, 2);
	if (!datePart || !timePart) return null;

	const [yearRaw, monthRaw, dayRaw] = datePart.split("/");
	const [hmsPart, fractionRaw = "0"] = timePart.split(".");
	const [hourRaw, minuteRaw, secondRaw] = hmsPart.split(":");

	const year = Number(yearRaw);
	const month = Number(monthRaw);
	const day = Number(dayRaw);
	const hour = Number(hourRaw);
	const minute = Number(minuteRaw);
	const second = Number(secondRaw);
	const ms = Number(fractionRaw.padEnd(3, "0").slice(0, 3));

	if (
		!Number.isFinite(year) ||
		!Number.isFinite(month) ||
		!Number.isFinite(day) ||
		!Number.isFinite(hour) ||
		!Number.isFinite(minute) ||
		!Number.isFinite(second) ||
		!Number.isFinite(ms)
	) {
		return null;
	}

	return Date.UTC(year, month - 1, day, hour, minute, second, ms);
};

const isIpLiteral = (value: string): boolean => {
	if (!value) return false;
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return true;
	return value.includes(":") && /^[0-9a-fA-F:]+$/.test(value);
};

const buildUserKey = (source: string, email: string | null) => {
	if (email?.trim()) {
		const label = email.trim();
		return { key: label.toLowerCase(), label };
	}

	let src = source.trim();
	if (src.includes(":") && !src.startsWith("[")) {
		src = src.split(":", 1)[0] || src;
	}
	return { key: src, label: src };
};

const guessPlatformFromLine = (
	destination: string,
	destinationIp: string | null,
): string => {
	const host = (destination || "").toLowerCase();
	if (host) {
		// Access log parser may emit truncated bracketed IPv6 hosts like "[2a02".
		if (host.startsWith("[")) return "ipv6";

		const rules: Array<[string[], string]> = [
			[["googlevideo.com", "ytimg.com", "youtube.com"], "youtube"],
			[["instagram.com", "cdninstagram.com", "fbcdn.net"], "instagram"],
			[["tiktok", "pangle", "ibyteimg.com", "byteimg.com"], "tiktok"],
			[["whatsapp.com", "whatsapp.net"], "whatsapp"],
			[["facebook.com", "messenger.com"], "facebook"],
			[["telegram.org", "t.me", "telegram.me"], "telegram"],
			[["snapchat.com"], "snapchat"],
			[["netflix.com"], "netflix"],
			[["twitter.com", "x.com"], "twitter"],
			[
				[
					"google.com",
					"googleapis.com",
					"gstatic.com",
					"gmail.com",
					"google.",
					"play.googleapis.com",
					"googlevideo.com",
					"googleusercontent.com",
					"crashlytics.com",
					"doubleclick.net",
				],
				"google",
			],
			[
				[
					"icloud.com",
					"apple.com",
					"mzstatic.com",
					"mail.me.com",
					"safebrowsing.apple",
				],
				"apple",
			],
			[
				[
					"microsoft.com",
					"live.com",
					"office.com",
					"msn.com",
					"bing.com",
					"trafficmanager.net",
					"vscode-cdn.net",
					"vscode.dev",
					"vscode-sync.",
				],
				"microsoft",
			],
			[
				[
					"github.com",
					"githubusercontent.com",
					"githubassets.com",
					"github.io",
					"github.dev",
					"alive.github.com",
				],
				"github",
			],
			[
				[
					"steampowered.com",
					"steamcommunity.com",
					"steamstatic.com",
					"steamserver.net",
					"steamcontent.com",
					"steam-chat.com",
				],
				"steam",
			],
			[
				[
					"chatgpt.com",
					"chat.openai.com",
					"ab.chatgpt.com",
					"openai.com",
					"auth.openai.com",
					"help.openai.com",
					"cdn.platform.openai.com",
					"cdn.openai.com",
					"oaistatic.com",
				],
				"openai",
			],
			[["opera.com", "operacdn.com"], "opera"],
			[["mail.yahoo.com", "yahoo.com", "yahoosandbox.net"], "yahoo"],
			[
				[
					"micloud.xiaomi.net",
					"miui.com",
					"xiaomi.com",
					"msg.global.xiaomi.net",
				],
				"xiaomi",
			],
			[["neshanmap.ir"], "neshan"],
			[["eitaa.com", "eitaa.ir"], "eitaa"],
			[["web.splus.ir"], "splus"],
			[["linkedin.com"], "linkedin"],
			[["divar.ir", "divarcdn.com"], "divar"],
			[["services.mozilla.com"], "mozilla"],
			[["codmwest.com"], "codm"],
			[["soundcloud.com"], "soundcloud"],
			[["discord.gg", "discord.com"], "discord"],
			[["yektanet.com"], "yektanet"],
			[["tsyndicate.com"], "tsyndicate"],
			[["uuidksinc.net"], "uuidksinc"],
			[["beyla.site"], "beyla"],
			[["flixcdn.com"], "flixcdn"],
			[["xhcdn.com", "xnxx-cdn.com"], "porn"],
			[["hansha.online"], "hansha"],
			[["sotoon.ir"], "sotoon"],
			[["ocsp-certum.com"], "certum"],
			[["mazholl.com"], "mazholl"],
			[["samsungosp.com", "samsungapps.com"], "samsung"],
			[["ipwho.is", "api.ip.sb", "seeip.org"], "ip_lookup"],
			[["cloudflare.com", "one.one.one.one"], "cloudflare"],
			[["applovin.com"], "applovin"],
			[["samsung.com", "samsungcloudcdn.com"], "samsung"],
		];

		for (const [needles, platform] of rules) {
			if (needles.some((needle) => host.includes(needle))) {
				return platform;
			}
		}

		if (host.includes("1.1.1.1")) return "cloudflare";
	}

	const ip = destinationIp || (isIpLiteral(destination) ? destination : "");
	if (ip) {
		const ipRules: Array<[string[], string]> = [
			[["149.154.", "91.108."], "telegram"],
			[["157.240.", "31.13.", "57.144.", "185.60."], "instagram"],
			[["140.82.", "185.199.", "20.201.", "192.30."], "github"],
			[["155.133.", "162.254.", "208.64.", "146.66.", "205.196."], "steam"],
			[["47.241.", "47.74.", "161.117."], "alibaba"],
			[["20.33."], "microsoft"],
			[["2.16.168."], "akamai"],
			[["2.189.58."], "eitaa"],
			[["2.189.68.", "5.28.", "85.133.", "185.79.", "195.254."], "iran"],
			[["13.51."], "aws"],
			[
				["188.212.98.", "89.167.", "194.26.66.", "74.1.1.", "87.248.132."],
				"hosting",
			],
			[["17."], "apple"],
			[
				[
					"172.64.",
					"162.159.",
					"104.16.",
					"104.17.",
					"104.18.",
					"104.19.",
					"104.20.",
				],
				"cloudflare",
			],
			[
				[
					"8.8.8.8",
					"8.8.4.4",
					"216.58.",
					"216.239.",
					"142.250.",
					"142.251.",
					"172.217.",
				],
				"google",
			],
			[["1.1.1.1", "1.0.0.1"], "cloudflare-dns"],
			[["10.", "127.", "239.255.255."], "local"],
		];
		for (const [prefixes, platform] of ipRules) {
			if (prefixes.some((prefix) => ip.startsWith(prefix))) {
				return platform;
			}
		}
	}

	return "other";
};

const parseAccessLogLine = (line: string): ParsedAccessLog | null => {
	const match = ACCESS_LINE_RE.exec(line.trim());
	if (!match?.groups) return null;

	const action = (match.groups.action || "").toLowerCase();
	const tsRaw = match.groups.ts || "";
	const destination = match.groups.dest || "";
	const destinationIp = isIpLiteral(destination) ? destination : null;
	const source = match.groups.src_ip || "";
	const email = match.groups.email || null;
	const route = match.groups.route || "";
	const user = buildUserKey(source, email);

	return {
		timestampMs: parseXrayTimestamp(tsRaw),
		action,
		destination,
		destinationIp,
		source,
		email,
		route,
		userKey: user.key,
		userLabel: user.label,
	};
};

const buildInsightsFromRawNdjson = (
	ndjson: string,
	lookbackLines: number,
	windowSeconds: number,
	limit: number,
): AccessInsightsResponse => {
	const clients = new Map<string, MutableClient>();
	const usersByPlatform = new Map<string, Set<string>>();
	const unmatched = new Map<string, AccessInsightUnmatched>();
	const sourceStatusMap = new Map<string, AccessInsightSourceStatus>();
	let matchedEntries = 0;
	let sources: AccessInsightSource[] = [];
	let streamError: string | undefined;
	const nodeErrors: string[] = [];
	const cutoffMs = Date.now() - windowSeconds * 1000;

	for (const row of ndjson.split("\n")) {
		const rawRow = row.trim();
		if (!rawRow) continue;

		let chunk: RawStreamChunk;
		try {
			chunk = JSON.parse(rawRow) as RawStreamChunk;
		} catch {
			continue;
		}

		if ("error" in chunk && !("type" in chunk)) {
			streamError = chunk.detail || chunk.error;
			continue;
		}

		if ("type" in chunk && chunk.type === "metadata") {
			sources = Array.isArray(chunk.sources) ? chunk.sources : [];
			continue;
		}

		if ("type" in chunk && chunk.type === "error") {
			const fromNode = chunk.node_name ? `[${chunk.node_name}] ` : "";
			nodeErrors.push(`${fromNode}${chunk.error}`);
			continue;
		}

		if ("type" in chunk && chunk.type === "source_status") {
			const key = `${chunk.node_id ?? "master"}:${chunk.node_name}`;
			sourceStatusMap.set(key, {
				node_id: chunk.node_id,
				node_name: chunk.node_name,
				is_master: chunk.is_master,
				connected: chunk.connected,
				ok: chunk.ok,
				total_lines: chunk.total_lines,
				matched_lines: chunk.matched_lines,
				error: chunk.error,
			});
			continue;
		}

		if (!("type" in chunk) || chunk.type !== "logs") {
			continue;
		}

		for (const rawLine of chunk.lines || []) {
			const parsed = parseAccessLogLine(rawLine);
			if (!parsed || parsed.action !== "accepted") continue;
			if (!parsed.timestampMs || parsed.timestampMs < cutoffMs) continue;

			let sourceIp = parsed.source || "";
			if (sourceIp.includes(":") && !sourceIp.startsWith("[")) {
				sourceIp = sourceIp.split(":", 1)[0] || sourceIp;
			}
			if (sourceIp.startsWith("127.") || sourceIp === "localhost") continue;

			const platform = guessPlatformFromLine(
				parsed.destination,
				parsed.destinationIp,
			);
			const userKey = parsed.userKey || "unknown";
			const userLabel = parsed.userLabel || userKey;

			if (!clients.has(userKey) && clients.size >= MAX_CLIENTS) {
				continue;
			}

			if (!usersByPlatform.has(platform)) {
				usersByPlatform.set(platform, new Set<string>());
			}
			usersByPlatform.get(platform)?.add(userKey);

			let client = clients.get(userKey);
			if (!client) {
				client = {
					user_key: userKey,
					user_label: userLabel,
					lastSeenMs: parsed.timestampMs,
					route: parsed.route || "",
					connectionEvents: 0,
					sources: new Set<string>(),
					nodes: new Set<string>(),
					platforms: new Map(),
				};
				clients.set(userKey, client);
			}

			if (chunk.node_name) {
				client.nodes.add(chunk.node_name);
			}
			if (sourceIp) {
				client.sources.add(sourceIp);
			}
			client.connectionEvents += 1;
			if (parsed.timestampMs > client.lastSeenMs) {
				client.lastSeenMs = parsed.timestampMs;
			}
			if (parsed.route) {
				client.route = parsed.route;
			}

			let platformData = client.platforms.get(platform);
			if (!platformData) {
				platformData = {
					platform,
					connections: 0,
					destinations: new Set<string>(),
				};
				client.platforms.set(platform, platformData);
			}
			platformData.connections += 1;
			if (parsed.destination) {
				platformData.destinations.add(parsed.destination);
			}

			matchedEntries += 1;

			if (platform === "other") {
				const key = `${parsed.destination || ""}:${parsed.destinationIp || ""}`;
				if (!unmatched.has(key)) {
					unmatched.set(key, {
						destination: parsed.destination || "",
						destination_ip: parsed.destinationIp,
						platform: "other",
					});
				}
			}
		}
	}

	const clientList: AccessInsightClient[] = Array.from(clients.values()).map(
		(client) => ({
			user_key: client.user_key,
			user_label: client.user_label,
			last_seen: new Date(client.lastSeenMs).toISOString(),
			route: client.route || "",
			connections: client.sources.size || client.connectionEvents,
			sources: Array.from(client.sources).sort(),
			platforms: Array.from(client.platforms.values())
				.map((platform) => ({
					platform: platform.platform,
					connections: platform.connections,
					destinations: Array.from(platform.destinations).sort().slice(0, 20),
				}))
				.sort((a, b) => b.connections - a.connections),
		}),
	);

	clientList.sort(
		(a, b) => dayjs(b.last_seen).valueOf() - dayjs(a.last_seen).valueOf(),
	);
	if (limit > 0) {
		clientList.splice(limit);
	}

	const platformCounts = Object.fromEntries(
		Array.from(usersByPlatform.entries()).map(([platform, users]) => [
			platform,
			users.size,
		]),
	);

	const totalUniqueClients = clients.size;
	const platforms = Array.from(usersByPlatform.entries())
		.map(([platform, users]) => ({
			platform,
			count: users.size,
			percent: totalUniqueClients ? users.size / totalUniqueClients : 0,
		}))
		.sort((a, b) => b.count - a.count);
	const finalError =
		streamError ||
		(matchedEntries === 0 && nodeErrors.length ? nodeErrors[0] : undefined);
	const detail =
		!streamError && nodeErrors.length
			? `Partial data from ${nodeErrors.length} source(s)`
			: undefined;

	return {
		mode: "frontend",
		sources,
		source_statuses: Array.from(sourceStatusMap.values()),
		log_path: sources.map((src) => src.node_name).join(", "),
		geo_assets_path: "frontend-stream",
		items: clientList,
		platform_counts: platformCounts,
		platforms,
		matched_entries: matchedEntries,
		error: finalError,
		detail,
		generated_at: new Date().toISOString(),
		lookback_lines: lookbackLines,
		window_seconds: windowSeconds,
		unmatched: Array.from(unmatched.values()),
	};
};

const enrichInsightsWithOperators = async (
	insights: AccessInsightsResponse,
): Promise<AccessInsightsResponse> => {
	const items = Array.isArray(insights.items) ? insights.items : [];
	if (!items.length) return insights;

	const hasOperators = items.some(
		(client) => Array.isArray(client.operators) && client.operators.length > 0,
	);
	if (hasOperators) return insights;

	const uniqueIps = Array.from(
		new Set(
			items
				.flatMap((client) =>
					(client.sources || []).map((ip) => (ip || "").trim()),
				)
				.filter((ip) => ip && isIpLiteral(ip)),
		),
	);
	if (!uniqueIps.length) return insights;

	let lookup: OperatorLookupResponse | null = null;
	try {
		lookup = await fetch<OperatorLookupResponse>("/core/access/operators", {
			method: "POST",
			body: { ips: uniqueIps },
		});
	} catch {
		return insights;
	}

	const entries = Array.isArray(lookup?.operators) ? lookup.operators : [];
	if (!entries.length) return insights;

	const operatorByIp = new Map(
		entries.map((entry) => [entry.ip, entry] as const),
	);

	const enrichedItems = items.map((client) => {
		const sourceIps = Array.from(
			new Set(
				(client.sources || [])
					.map((ip) => (ip || "").trim())
					.filter((ip) => ip && isIpLiteral(ip)),
			),
		);
		const operators = sourceIps.map((ip) => {
			const meta = operatorByIp.get(ip);
			return {
				ip,
				short_name: meta?.short_name || "Unknown",
				owner: meta?.owner || meta?.short_name || "Unknown",
			};
		});

		const operatorCounts: Record<string, number> = {};
		for (const operator of operators) {
			const key =
				(operator.short_name || operator.owner || "Unknown").trim() ||
				"Unknown";
			operatorCounts[key] = (operatorCounts[key] || 0) + 1;
		}

		return {
			...client,
			operators,
			operator_counts: operatorCounts,
		};
	});

	return {
		...insights,
		items: enrichedItems,
	};
};

const buildApiUrl = (path: string, query: URLSearchParams) => {
	const base = ((import.meta.env.VITE_BASE_API as string | undefined) || "/api")
		.replace(/\/+$/, "")
		.trim();
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${base}${normalizedPath}?${query.toString()}`;
};

type PlatformStat = [string, number, number | undefined];

const AccessInsightsPage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewXray =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const { data: panelSettings } = useQuery(
		["panel-settings"],
		getPanelSettings,
	);
	const insightsEnabled = panelSettings?.access_insights_enabled ?? false;

	const [data, setData] = useState<AccessInsightsResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [search, setSearch] = useState("");
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showAllUnmatched, setShowAllUnmatched] = useState(false);

	const loadData = useCallback(async () => {
		if (!canViewXray || !insightsEnabled) return;
		setLoading(true);
		setError(null);
		try {
			const query = new URLSearchParams({
				max_lines: String(DEFAULT_MAX_LINES),
			});
			const token = getAuthToken();
			const rawResponse = await window.fetch(
				buildApiUrl("/core/access/logs/raw", query),
				{
					method: "GET",
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					cache: "no-store",
				},
			);
			if (!rawResponse.ok) {
				throw new Error(`Failed to stream raw logs (${rawResponse.status})`);
			}
			const ndjson = await rawResponse.text();
			const parsed = buildInsightsFromRawNdjson(
				ndjson,
				DEFAULT_MAX_LINES,
				DEFAULT_WINDOW_SECONDS,
				DEFAULT_LIMIT,
			);
			const enrichedParsed = await enrichInsightsWithOperators(parsed);
			if (parsed?.error) {
				setError(parsed.detail || parsed.error);
			}
			setData(enrichedParsed);
			setShowAllUnmatched(false);
		} catch (rawErr) {
			try {
				const query = new URLSearchParams({
					limit: String(DEFAULT_LIMIT),
					lookback: String(DEFAULT_MAX_LINES),
					window_seconds: String(DEFAULT_WINDOW_SECONDS),
				});
				const response = await fetch<AccessInsightsResponse>(
					`/core/access/insights/multi-node?${query.toString()}`,
				);
				const enrichedResponse = await enrichInsightsWithOperators(response);
				if (response?.error) {
					setError(response.detail || response.error);
				}
				setData(enrichedResponse);
				setShowAllUnmatched(false);
			} catch (err: any) {
				setError(
					err?.message ||
						(rawErr as Error)?.message ||
						t(
							"pages.accessInsights.errors.loadFailed",
							"Failed to load access insights",
						),
				);
			}
		} finally {
			setLoading(false);
		}
	}, [canViewXray, insightsEnabled, t]);

	useEffect(() => {
		if (insightsEnabled) {
			loadData();
		}
	}, [loadData, insightsEnabled]);

	useEffect(() => {
		if (!autoRefresh || !canViewXray || !insightsEnabled) return;
		const id = window.setInterval(loadData, REFRESH_INTERVAL);
		return () => window.clearInterval(id);
	}, [autoRefresh, canViewXray, insightsEnabled, loadData]);

	// Keep auto-refresh off when disabled
	useEffect(() => {
		if (!insightsEnabled) {
			setAutoRefresh(false);
		}
	}, [insightsEnabled]);

	// Clients are already aggregated on backend; just reuse them
	const clients = useMemo(() => data?.items || [], [data]);
	const platformClientCounts = useMemo(() => {
		const counts = data?.platform_counts || {};
		return new Map(Object.entries(counts));
	}, [data]);

	const platformStats: PlatformStat[] = useMemo(() => {
		if (data?.platforms && Array.isArray(data.platforms)) {
			return data.platforms
				.slice(0, 6)
				.map((p) => [p.platform, p.count, p.percent] as PlatformStat);
		}
		const totalUsers = clients.length || 0;
		const entries = Array.from(platformClientCounts.entries());
		return entries
			.sort((a, b) => b[1] - a[1])
			.slice(0, 6)
			.map(
				([label, count]) =>
					[
						label,
						count,
						totalUsers ? count / totalUsers : undefined,
					] as PlatformStat,
			);
	}, [data, platformClientCounts, clients]);

	const unmatched: AccessInsightUnmatched[] = useMemo(
		() => data?.unmatched || [],
		[data],
	);
	const visibleUnmatched = useMemo(
		() => (showAllUnmatched ? unmatched : unmatched.slice(0, 3)),
		[showAllUnmatched, unmatched],
	);

	const operatorTotals = useMemo(() => {
		const totals = new Map<string, Set<string>>();
		(clients as AccessInsightClient[]).forEach((client) => {
			(client.operators || []).forEach((op) => {
				const label =
					(op.short_name || op.owner || "Unknown").trim() || "Unknown";
				if (!totals.has(label)) totals.set(label, new Set<string>());
				if (op.ip) totals.get(label)?.add(op.ip);
			});
		});
		return totals;
	}, [clients]);

	const operatorSummary = useMemo(() => {
		const entries = Array.from(operatorTotals.entries()).map(
			([name, ips]) => [name, ips.size] as [string, number],
		);
		return entries.sort((a, b) => b[1] - a[1]);
	}, [operatorTotals]);

	const filteredClients = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return clients;
		return (clients as AccessInsightClient[]).filter((client) => {
			if (client.user_label.toLowerCase().includes(q)) return true;
			if ((client.route || "").toLowerCase().includes(q)) return true;
			for (const p of client.platforms || []) {
				if (p.platform.toLowerCase().includes(q)) return true;
				for (const dest of p.destinations || []) {
					if (dest.toLowerCase().includes(q)) return true;
				}
			}
			return false;
		});
	}, [clients, search]);

	const sourceStatuses = useMemo(() => data?.source_statuses || [], [data]);

	const successfulNodeNames = useMemo(() => {
		if (sourceStatuses.length) {
			const names = sourceStatuses
				.filter((status) => status.ok)
				.map((status) => status.node_name)
				.filter(Boolean);
			return Array.from(new Set(names));
		}
		const fallbackNames =
			data?.sources?.map((source) => source.node_name).filter(Boolean) || [];
		return Array.from(new Set(fallbackNames));
	}, [data, sourceStatuses]);

	const failedNodeStatuses = useMemo(
		() => sourceStatuses.filter((status) => !status.ok),
		[sourceStatuses],
	);

	if (!canViewXray) {
		return (
			<Box p={6}>
				<Text color="gray.500">
					{t(
						"pages.accessInsights.noPermission",
						"You do not have access to Xray insights.",
					)}
				</Text>
			</Box>
		);
	}

	return (
		<Box p={6} display="flex" flexDirection="column" gap={4}>
			<Stack spacing={2} position="relative">
				<Text fontSize="2xl" fontWeight="bold">
					{t("pages.accessInsights.title", "Live Access Insights")}
				</Text>
				<Text color="gray.500">
					{t(
						"pages.accessInsights.subtitle",
						"Recent connections are grouped using geosite/geoip data to highlight which platforms users are reaching.",
					)}
				</Text>
				<Text color="gray.600" fontSize="sm" fontFamily="mono">
					nodes:{" "}
					{successfulNodeNames.length ? successfulNodeNames.join(",") : "-"}
				</Text>
				{failedNodeStatuses.length ? (
					<Text color="red.400" fontSize="sm">
						unreachable:{" "}
						{failedNodeStatuses.map((status) => status.node_name).join(",")}
					</Text>
				) : null}
				{!insightsEnabled ? (
					<Box
						position="absolute"
						inset={0}
						bg="rgba(0,0,0,0.6)"
						backdropFilter="blur(4px)"
						display="flex"
						alignItems="center"
						justifyContent="center"
						zIndex={1}
						borderRadius="md"
					>
						<Text
							fontSize="lg"
							fontWeight="bold"
							color="white"
							textAlign="center"
							px={4}
						>
							{t(
								"pages.accessInsights.disabled",
								"Access Insights is disabled in panel settings",
							)}
						</Text>
					</Box>
				) : null}
			</Stack>

			<HStack spacing={3} flexWrap="wrap">
				<InputGroup maxW={{ base: "full", md: "360px" }}>
					<InputLeftElement pointerEvents="none">
						<MagnifyingGlassIcon width={18} />
					</InputLeftElement>
					<Input
						placeholder={t(
							"pages.accessInsights.search",
							"Search platform, host, or email",
						)}
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setShowAllUnmatched(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								loadData();
							}
						}}
						isDisabled={!insightsEnabled}
					/>
				</InputGroup>
				<HStack spacing={2}>
					<Switch
						isChecked={autoRefresh}
						onChange={(e) => setAutoRefresh(e.target.checked)}
						isDisabled={!insightsEnabled}
					>
						{t("pages.accessInsights.autoRefresh", "Auto refresh")}
					</Switch>
					<Tooltip label={t("pages.accessInsights.refreshNow", "Refresh now")}>
						<IconButton
							aria-label="refresh"
							icon={<ArrowPathIcon width={18} />}
							onClick={loadData}
							isDisabled={loading || !insightsEnabled}
						/>
					</Tooltip>
				</HStack>
				<HStack spacing={2} color="gray.500" fontSize="sm">
					<Text>
						{t("pages.accessInsights.sources", "Sources")}:{" "}
						<Badge colorScheme="blue">{data?.sources?.length || 0}</Badge>
					</Text>
					{data?.sources?.length ? (
						<Tooltip
							label={data.sources
								.map((src) => src.node_name)
								.filter(Boolean)
								.join(", ")}
						>
							<Badge colorScheme="green">
								{t("pages.accessInsights.multiNode", "Master + active nodes")}
							</Badge>
						</Tooltip>
					) : null}
					<Text>
						{t("pages.accessInsights.logPath", "Log")}:{" "}
						<Badge colorScheme="gray">
							{data?.log_path || t("pages.accessInsights.unknown", "Unknown")}
						</Badge>
					</Text>
					{data?.geo_assets_path ? (
						<Text>
							{t("pages.accessInsights.geoPath", "Geo assets")}:{" "}
							<Badge colorScheme="gray">{data.geo_assets_path}</Badge>
						</Text>
					) : null}
					{data?.geo_assets ? (
						<Badge
							colorScheme={
								data.geo_assets.geosite && data.geo_assets.geoip
									? "green"
									: "orange"
							}
						>
							{data.geo_assets.geosite ? "geosite" : "geosite missing"} /{" "}
							{data.geo_assets.geoip ? "geoip" : "geoip missing"}
						</Badge>
					) : null}
					<Badge colorScheme={data?.mode === "frontend" ? "purple" : "gray"}>
						{data?.mode === "frontend"
							? t("pages.accessInsights.frontMode", "Frontend aggregation")
							: t("pages.accessInsights.backMode", "Backend aggregation")}
					</Badge>
				</HStack>
			</HStack>

			{error ? (
				<Alert status="error">
					<AlertIcon />
					{error}
				</Alert>
			) : null}

			<SimpleGrid
				columns={{ base: 1, md: 3 }}
				spacing={4}
				opacity={insightsEnabled ? 1 : 0.3}
				filter={insightsEnabled ? "none" : "blur(2px)"}
			>
				{platformStats.map(([label, count, percent]) => (
					<Stat key={label} borderWidth="1px" borderRadius="md" p={4}>
						<StatLabel>
							<HStack spacing={2}>
								<Box fontSize="lg">{renderPlatformIcon(label)}</Box>
								<Text>{label}</Text>
							</HStack>
						</StatLabel>
						<StatNumber>
							{count}
							{percent !== undefined ? (
								<Text as="span" ml={2} fontSize="sm" color="gray.500">
									{Math.round((percent || 0) * 100)}%
								</Text>
							) : null}
						</StatNumber>
					</Stat>
				))}
				{platformStats.length === 0 && !loading ? (
					<Box borderWidth="1px" borderRadius="md" p={4}>
						<Text color="gray.500">
							{t("pages.accessInsights.noData", "No recent connections found.")}
						</Text>
					</Box>
				) : null}
			</SimpleGrid>

			{operatorSummary.length > 0 ? (
				<Box borderWidth="1px" borderRadius="md" p={4}>
					<Text fontWeight="bold" mb={2}>
						{t(
							"pages.accessInsights.operatorSummary",
							"Operators by unique IPs",
						)}
					</Text>
					<HStack spacing={3} flexWrap="wrap">
						{operatorSummary.map(([op, count]) => (
							<Badge
								key={op}
								variant="outline"
								px={3}
								py={2}
								display="flex"
								alignItems="center"
								gap={2}
							>
								{renderOperatorIcon(op)}
								<Text>{op}</Text>
								<Text fontWeight="bold">{count}</Text>
							</Badge>
						))}
					</HStack>
				</Box>
			) : null}

			{unmatched.length > 0 ? (
				<Box borderWidth="1px" borderRadius="md" p={3}>
					<HStack justify="space-between" align="center" mb={2}>
						<Text fontWeight="bold">
							{t(
								"pages.accessInsights.unmatchedTitle",
								"Unmapped destinations",
							)}
						</Text>
						<HStack spacing={2}>
							<Button
								size="xs"
								variant="outline"
								onClick={() => setShowAllUnmatched((prev) => !prev)}
							>
								{showAllUnmatched
									? t("pages.accessInsights.unmatchedLess", "Show less")
									: t("pages.accessInsights.unmatchedMoreBtn", "Show more")}
							</Button>
							<Tooltip
								label={t("pages.accessInsights.copyUnmatched", "Copy as JSON")}
							>
								<IconButton
									aria-label="copy-unmatched"
									icon={<ClipboardDocumentIcon width={18} />}
									size="xs"
									onClick={() =>
										navigator.clipboard.writeText(
											JSON.stringify(unmatched, null, 2),
										)
									}
								/>
							</Tooltip>
						</HStack>
					</HStack>
					<Table size="sm" variant="simple">
						<Thead>
							<Tr>
								<Th>{t("pages.accessInsights.destination", "Destination")}</Th>
								<Th>{t("pages.accessInsights.ip", "IP")}</Th>
							</Tr>
						</Thead>
						<Tbody>
							{visibleUnmatched.map((row, idx) => (
								<Tr
									key={`${row.destination}-${row.destination_ip || "noip"}-${idx}`}
								>
									<Td fontFamily="mono" fontSize="sm">
										{row.destination || "-"}
									</Td>
									<Td fontFamily="mono" fontSize="sm">
										{row.destination_ip || "-"}
									</Td>
								</Tr>
							))}
						</Tbody>
					</Table>
					{!showAllUnmatched && unmatched.length > 3 ? (
						<Text mt={2} color="gray.500" fontSize="sm">
							{t(
								"pages.accessInsights.unmatchedMore",
								"{{count}} more entries not shown",
								{
									count: unmatched.length - 3,
								},
							)}
						</Text>
					) : null}
				</Box>
			) : null}

			<Stack
				spacing={4}
				opacity={insightsEnabled ? 1 : 0.3}
				filter={insightsEnabled ? "none" : "blur(2px)"}
			>
				{filteredClients.map((client) => (
					<Box key={client.user_key} borderWidth="1px" borderRadius="lg" p={4}>
						<HStack justify="space-between" align="start" flexWrap="wrap">
							<VStack align="start" spacing={1}>
								<Text fontWeight="bold">{client.user_label}</Text>
								<Text fontSize="sm" color="gray.500">
									{t("pages.accessInsights.ips", "IPs")}:{" "}
									{(client.sources || []).join(", ") || "-"}
								</Text>
								<Text fontSize="sm" color="gray.500">
									{t("pages.accessInsights.route", "Route")}:{" "}
									{client.route || "-"}
								</Text>
								<Text fontSize="sm" color="gray.500">
									{t("pages.accessInsights.lastSeen", "Last seen")}:{" "}
									{dayjs(client.last_seen).format("HH:mm:ss")}
								</Text>
								{client.operator_counts &&
								Object.keys(client.operator_counts).length > 0 ? (
									<HStack spacing={2} wrap="wrap">
										{Object.entries(client.operator_counts).map(([op, cnt]) => (
											<Badge
												key={op}
												variant="outline"
												display="flex"
												alignItems="center"
												gap={2}
											>
												{renderOperatorIcon(op)}
												<Text>{op}</Text>
												<Text as="span">({cnt})</Text>
											</Badge>
										))}
									</HStack>
								) : null}
							</VStack>
							<Badge colorScheme="purple">
								{t("pages.accessInsights.connections", "Connections")}:{" "}
								{client.connections}
							</Badge>
						</HStack>
						<Table size="sm" mt={3}>
							<Thead>
								<Tr>
									<Th>{t("pages.accessInsights.platform", "Platform")}</Th>
									<Th isNumeric>
										{t("pages.accessInsights.connections", "Connections")}
									</Th>
									<Th>
										{t("pages.accessInsights.destination", "Destination")}
									</Th>
								</Tr>
							</Thead>
							<Tbody>
								{client.platforms.map((p: AccessInsightPlatform) => (
									<Tr key={p.platform}>
										<Td>
											<HStack spacing={2}>
												<Box fontSize="lg" color="inherit">
													{renderPlatformIcon(p.platform)}
												</Box>
												<Text fontWeight="semibold" color="inherit">
													{p.platform}
												</Text>
											</HStack>
										</Td>
										<Td isNumeric>{p.connections}</Td>
										<Td>
											<Text fontSize="sm" color="gray.600">
												{(p.destinations || []).slice(0, 3).join(", ")}
											</Text>
										</Td>
									</Tr>
								))}
							</Tbody>
						</Table>
					</Box>
				))}
				{filteredClients.length === 0 && !loading ? (
					<Box borderWidth="1px" borderRadius="md" p={4}>
						<Text color="gray.500">
							{t("pages.accessInsights.noData", "No recent connections found.")}
						</Text>
					</Box>
				) : null}
				{loading ? (
					<HStack spacing={2} justify="center">
						<Spinner size="sm" />
						<Text color="gray.500">
							{t("pages.accessInsights.loading", "Loading access log...")}
						</Text>
					</HStack>
				) : null}
			</Stack>
		</Box>
	);
};

export default AccessInsightsPage;
