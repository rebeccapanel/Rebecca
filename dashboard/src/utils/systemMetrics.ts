import type {
	HistoryEntry,
	NetworkHistoryEntry,
	SystemStats,
} from "types/System";

const HISTORY_MAX_ENTRIES = 600;
const HISTORY_SAMPLE_SECONDS = 30;
const TOTAL_NETWORK_HISTORY_KEY = "rb-total-network-history-v1";
const TOTAL_NETWORK_SAMPLE_SECONDS = 2;
const TOTAL_NETWORK_MAX_AGE_SECONDS = 5 * 3600;

let totalNetworkMemoryCache: NetworkHistoryEntry[] | null = null;

const readStoredTotalNetworkHistory = (): NetworkHistoryEntry[] => {
	if (totalNetworkMemoryCache) return totalNetworkMemoryCache;
	if (typeof window === "undefined") return [];
	try {
		const raw = sessionStorage.getItem(TOTAL_NETWORK_HISTORY_KEY);
		if (!raw) {
			totalNetworkMemoryCache = [];
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			totalNetworkMemoryCache = [];
			return [];
		}
		const cutoff = Math.floor(Date.now() / 1000) - TOTAL_NETWORK_MAX_AGE_SECONDS;
		const valid = parsed.filter(
			(item): item is NetworkHistoryEntry =>
				Boolean(item) &&
				typeof item.timestamp === "number" &&
				Number.isFinite(item.timestamp) &&
				item.timestamp >= cutoff &&
				typeof item.incoming === "number" &&
				Number.isFinite(item.incoming) &&
				typeof item.outgoing === "number" &&
				Number.isFinite(item.outgoing),
		);
		totalNetworkMemoryCache = valid.slice(-HISTORY_MAX_ENTRIES);
		return totalNetworkMemoryCache;
	} catch {
		totalNetworkMemoryCache = [];
		return [];
	}
};

const writeStoredTotalNetworkHistory = (entries: NetworkHistoryEntry[]) => {
	totalNetworkMemoryCache = entries;
	if (typeof window === "undefined") return;
	try {
		sessionStorage.setItem(TOTAL_NETWORK_HISTORY_KEY, JSON.stringify(entries));
	} catch {}
};

export const getTotalNetworkHistory = (): NetworkHistoryEntry[] =>
	readStoredTotalNetworkHistory();

export const recordTotalNetworkSample = (
	incoming: number,
	outgoing: number,
	timestamp = Math.floor(Date.now() / 1000),
): NetworkHistoryEntry[] => {
	if (!Number.isFinite(incoming) || !Number.isFinite(outgoing)) {
		return readStoredTotalNetworkHistory();
	}
	const current = readStoredTotalNetworkHistory();
	const cutoff = timestamp - TOTAL_NETWORK_MAX_AGE_SECONDS;
	const pruned = current.filter((item) => item.timestamp >= cutoff);
	const last = pruned[pruned.length - 1];
	let next: NetworkHistoryEntry[];
	if (!last) {
		next = [{ timestamp, incoming, outgoing }];
	} else if (timestamp - last.timestamp < TOTAL_NETWORK_SAMPLE_SECONDS) {
		next = [...pruned.slice(0, -1), { timestamp: last.timestamp, incoming, outgoing }];
	} else {
		next = [...pruned, { timestamp, incoming, outgoing }].slice(-HISTORY_MAX_ENTRIES);
	}
	writeStoredTotalNetworkHistory(next);
	return next;
};

const appendHistory = <T extends { timestamp: number }>(
	entries: T[] | null | undefined,
	entry: T,
): T[] => {
	const current = Array.isArray(entries) ? entries : [];
	if (!current.length) return [entry];
	const last = current[current.length - 1];
	if (entry.timestamp - last.timestamp < HISTORY_SAMPLE_SECONDS) {
		return [...current.slice(0, -1), { ...entry, timestamp: last.timestamp }];
	}
	return [...current, entry].slice(-HISTORY_MAX_ENTRIES);
};

export const mergeLiveSystemStats = (
	current: SystemStats | undefined,
	next: SystemStats,
	timestamp = Math.floor(Date.now() / 1000),
): SystemStats => ({
	...current,
	...next,
	cpu_history: appendHistory(current?.cpu_history, {
		timestamp,
		value: next.cpu_usage,
	}),
	memory_history: appendHistory(current?.memory_history, {
		timestamp,
		value: next.memory.percent,
	}),
	swap_history: appendHistory(current?.swap_history, {
		timestamp,
		value: next.swap.percent,
	}),
	disk_history: appendHistory(current?.disk_history, {
		timestamp,
		value: next.disk.percent,
	}),
	network_history: appendHistory<NetworkHistoryEntry>(current?.network_history, {
		timestamp,
		incoming: next.incoming_bandwidth_speed,
		outgoing: next.outgoing_bandwidth_speed,
	}),
	panel_cpu_history: appendHistory(current?.panel_cpu_history, {
		timestamp,
		value: next.panel_cpu_percent,
	}),
	panel_memory_history: appendHistory(current?.panel_memory_history, {
		timestamp,
		value: next.panel_memory_percent,
	}),
});

export const sampleSparklineValues = (
	values: number[],
	maxPoints = 80,
): number[] => {
	if (values.length <= maxPoints || maxPoints < 2) return values;
	const lastIndex = values.length - 1;
	return Array.from(
		{ length: maxPoints },
		(_, index) => values[Math.round((index * lastIndex) / (maxPoints - 1))],
	);
};

export type { HistoryEntry };
