import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Download, ChevronsDown, Pause, Play, Trash2 } from "lucide-react";
import { useColorMode } from "lib/color-mode";

import { cn } from "lib/cn";
import { PanelSelect as Select, type PanelSelectProps as SelectProps } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { PageLoadingSkeleton } from "components/ui";
import { ListCard } from "components/ui/list-card";
import { SegmentedControl } from "components/ui/segmented-control";
import { useNodesQuery } from "contexts/NodesContext";
import useGetUser from "hooks/useGetUser";
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useWebSocket from "react-use-websocket";
import { fetch } from "service/http";
import type { RawInbound } from "utils/inbounds";
import { DEFAULT_SEARCH_MATCH_OPTIONS, matchesSearch } from "utils/searchMatch";
import { getAPIWebSocketURL } from "utils/websocket";

const MAX_NUMBER_OF_LOGS = 500;
const LOG_FLUSH_INTERVAL = 100;
const AT_BOTTOM_THRESHOLD = 32;

type LogEntry = {
	id: number;
	message: string;
};

type LogLevel = "error" | "warn" | "success" | "info" | "debug" | "default";
type LevelFilter = "all" | "error" | "warn" | "info" | "debug";
type LevelGroup = Exclude<LevelFilter, "all"> | "other";

const LEVEL_LABELS: Record<LogLevel, string> = {
	error: "ERROR",
	warn: "WARN",
	success: "OK",
	info: "INFO",
	debug: "DEBUG",
	default: "LOG",
};

const levelGroupOf = (level: LogLevel): LevelGroup => {
	if (level === "success") return "info";
	if (level === "default") return "other";
	return level;
};

const getWebsocketUrl = (nodeID: string) => {
	if (!nodeID) return null;
	return getAPIWebSocketURL(`/node/${nodeID}/logs`, { interval: 1 });
};

const classifyLog = (message: string): LogLevel => {
	const lowerMessage = message.toLowerCase();
	const explicitMatch = message.match(/\[(debug|info|warning|warn|error|fatal|panic|critical)\]/i);
	if (explicitMatch?.[1]) {
		const explicit = explicitMatch[1].toLowerCase();
		if (["error", "fatal", "panic", "critical"].includes(explicit)) return "error";
		if (["warning", "warn"].includes(explicit)) return "warn";
		if (explicit === "debug") return "debug";
		return "info";
	}
	if (
		/^xray\s+\d+/i.test(message) ||
		/unified platform for anti-censorship/i.test(lowerMessage) ||
		/core:\s*xray.*started/i.test(lowerMessage)
	) {
		return "success";
	}
	if (/error|failed|exception|fatal|panic|critical/i.test(lowerMessage)) return "error";
	if (/warn|warning|deprecated/i.test(lowerMessage)) return "warn";
	if (/success|connected|started|stopped/i.test(lowerMessage)) return "success";
	if (/info|information/i.test(lowerMessage)) return "info";
	if (/debug|trace|verbose/i.test(lowerMessage)) return "debug";
	return "default";
};

interface XrayLogsPageProps {
	showTitle?: boolean;
}

const CompactLogSelect = (props: SelectProps) => <Select size="sm" {...props} className="w-full xl:w-[200px]" />;

export const XrayLogsPage: FC<XrayLogsPageProps> = ({ showTitle = true }) => {
	const { t } = useTranslation();
	const { userData, getUserIsPending, getUserIsSuccess } = useGetUser();
	const canViewXrayLogs = getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const { data: nodes } = useNodesQuery({ enabled: canViewXrayLogs });
	const [selectedNode, setNode] = useState<string>("");
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const pendingLogs = useRef<LogEntry[]>([]);
	const flushTimer = useRef<number | null>(null);
	const nextLogID = useRef(0);
	const [searchFilter, setSearchFilter] = useState<string>("");
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
	const [selectedInbound, setSelectedInbound] = useState<string>("");
	const [inbounds, setInbounds] = useState<RawInbound[]>([]);
	const [inboundsLoading, setInboundsLoading] = useState(false);
	const [paused, setPaused] = useState(false);
	const pausedRef = useRef(false);
	const [wrapLines, setWrapLines] = useState(true);
	const logsDiv = useRef<HTMLDivElement | null>(null);
	const [autoScroll, setAutoScroll] = useState(true);
	const autoScrollRef = useRef(true);
	const { colorMode } = useColorMode();

	// Fetch inbounds list
	useEffect(() => {
		if (!canViewXrayLogs) return;
		setInboundsLoading(true);
		fetch<RawInbound[]>("/inbounds/full")
			.then((data) => {
				setInbounds(data || []);
			})
			.catch((err) => {
				console.error("Failed to fetch inbounds:", err);
				setInbounds([]);
			})
			.finally(() => {
				setInboundsLoading(false);
			});
	}, [canViewXrayLogs]);

	const handleLog = (id: string) => {
		if (id === selectedNode) return;
		setNode(id);
		pendingLogs.current = [];
		setLogs([]);
	};

	useEffect(() => {
		if (!nodes?.length) {
			if (selectedNode) {
				setNode("");
				setLogs([]);
			}
			return;
		}
		if (!selectedNode || !nodes.some((node) => String(node.id) === selectedNode)) {
			setNode(String(nodes[0].id));
			setLogs([]);
		}
	}, [nodes, selectedNode]);

	const scrollToLatest = useCallback(() => {
		autoScrollRef.current = true;
		setAutoScroll(true);
		if (logsDiv.current) {
			logsDiv.current.scrollTop = logsDiv.current.scrollHeight;
		}
	}, []);

	const flushLogs = useCallback(() => {
		flushTimer.current = null;
		if (pausedRef.current) return;
		const batch = pendingLogs.current;
		pendingLogs.current = [];
		if (batch.length === 0) return;
		setLogs((current) => [...current, ...batch].slice(-MAX_NUMBER_OF_LOGS));
		window.requestAnimationFrame(() => {
			if (autoScrollRef.current && logsDiv.current) {
				logsDiv.current.scrollTop = logsDiv.current.scrollHeight;
			}
		});
	}, []);

	const appendLog = useCallback(
		(line: string) => {
			pendingLogs.current.push({ id: nextLogID.current++, message: line });
			if (pausedRef.current) {
				if (pendingLogs.current.length > MAX_NUMBER_OF_LOGS) {
					pendingLogs.current.splice(0, pendingLogs.current.length - MAX_NUMBER_OF_LOGS);
				}
				return;
			}
			if (flushTimer.current === null) {
				flushTimer.current = window.setTimeout(flushLogs, LOG_FLUSH_INTERVAL);
			}
		},
		[flushLogs],
	);

	const togglePaused = useCallback(() => {
		const next = !pausedRef.current;
		pausedRef.current = next;
		setPaused(next);
		if (!next) flushLogs();
	}, [flushLogs]);

	const clearLogs = useCallback(() => {
		pendingLogs.current = [];
		setLogs([]);
	}, []);

	useEffect(() => {
		return () => {
			if (flushTimer.current !== null) {
				window.clearTimeout(flushTimer.current);
			}
		};
	}, []);

	const socketUrl = useMemo(
		() => (canViewXrayLogs ? getWebsocketUrl(selectedNode) : null),
		[canViewXrayLogs, selectedNode],
	);

	const { readyState } = useWebSocket(
		socketUrl,
		{
			onMessage: (e: any) => {
				appendLog(e.data ?? "");
			},
			shouldReconnect: () => Boolean(socketUrl),
			reconnectAttempts: 10,
			reconnectInterval: 1000,
		},
		Boolean(socketUrl),
	);

	useEffect(() => {
		const element = logsDiv.current;
		if (!element) return;
		const handleScroll = () => {
			const isAtBottom =
				element.scrollHeight - element.scrollTop - element.clientHeight <= AT_BOTTOM_THRESHOLD;
			autoScrollRef.current = isAtBottom;
			setAutoScroll(isAtBottom);
		};
		element.addEventListener("scroll", handleScroll);
		handleScroll();
		return () => {
			element.removeEventListener("scroll", handleScroll);
		};
	}, []);

	const logPalette = useMemo(() => {
		const isDark = colorMode === "dark";
		return {
			error: {
				bg: isDark ? "rgba(239, 68, 68, 0.18)" : "rgba(254, 226, 226, 0.9)",
				color: isDark ? "#fca5a5" : "#dc2626",
				border: isDark ? "#ef4444" : "#dc2626",
			},
			warn: {
				bg: isDark ? "rgba(234, 179, 8, 0.18)" : "rgba(254, 243, 199, 0.9)",
				color: isDark ? "#fde047" : "#ca8a04",
				border: isDark ? "#eab308" : "#facc15",
			},
			success: {
				bg: isDark ? "rgba(34, 197, 94, 0.18)" : "rgba(209, 250, 229, 0.9)",
				color: isDark ? "#86efac" : "#16a34a",
				border: "#22c55e",
			},
			info: {
				bg: isDark ? "rgba(59, 130, 246, 0.18)" : "rgba(219, 234, 254, 0.9)",
				color: isDark ? "#93c5fd" : "#2563eb",
				border: "#3b82f6",
			},
			debug: {
				bg: isDark ? "rgba(148, 163, 184, 0.16)" : "rgba(241, 245, 249, 0.9)",
				color: isDark ? "#cbd5e1" : "#475569",
				border: "#94a3b8",
			},
			default: {
				bg: isDark ? "rgba(51, 65, 85, 0.12)" : "rgba(248, 250, 252, 0.9)",
				color: isDark ? "#e2e8f0" : "#64748b",
				border: isDark ? "#475569" : "#cbd5e1",
			},
		};
	}, [colorMode]);

	const socketStatusLabel = useMemo(() => {
		if (readyState === 0) return t("core.socket.connecting");
		if (readyState === 1) return t("core.socket.connected");
		if (readyState === 2 || readyState === 3) return t("core.socket.closed");
		return t("core.socket.not_connected");
	}, [readyState, t]);
	const socketDotClass =
		readyState === 1 ? "bg-panel-success" : readyState === 0 ? "bg-panel-warning" : "bg-panel-text-muted";

	const classifiedLogs = useMemo(
		() => logs.map((log) => ({ ...log, level: classifyLog(log.message) })),
		[logs],
	);

	const levelCounts = useMemo(() => {
		const counts: Record<LevelGroup, number> = { error: 0, warn: 0, info: 0, debug: 0, other: 0 };
		for (const log of classifiedLogs) {
			counts[levelGroupOf(log.level)] += 1;
		}
		return counts;
	}, [classifiedLogs]);

	// Get selected inbound tag
	const selectedInboundTag = useMemo(() => {
		if (!selectedInbound) return null;
		const inbound = inbounds.find((inv) => inv.tag === selectedInbound);
		return inbound?.tag || null;
	}, [selectedInbound, inbounds]);

	const filteredLogs = useMemo(() => {
		let filtered = classifiedLogs;
		if (levelFilter !== "all") {
			filtered = filtered.filter((log) => levelGroupOf(log.level) === levelFilter);
		}
		if (selectedInboundTag) {
			const tag = selectedInboundTag.toLowerCase();
			filtered = filtered.filter((log) => log.message.toLowerCase().includes(tag));
		}
		if (searchFilter.trim()) {
			filtered = filtered.filter((log) => matchesSearch(log.message, searchFilter, searchMatch));
		}
		return filtered;
	}, [classifiedLogs, levelFilter, searchFilter, searchMatch, selectedInboundTag]);

	const renderMessage = (id: number, message: string) => {
		if (!searchFilter) return message;
		const parts = message.split(
			new RegExp(
				`(${searchFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
				searchMatch.matchCase ? "g" : "gi",
			),
		);
		return parts.map((part, idx) => {
			const partKey = `${id}-part-${idx}`;
			if (matchesSearch(part, searchFilter, { ...searchMatch, matchWholeWord: false })) {
				return (
					<span key={partKey} className="bg-yellow-300 text-black px-1 rounded-xs font-semibold dark:bg-yellow-500 dark:text-black">
						{part}
					</span>
				);
			}
			return <React.Fragment key={partKey}>{part}</React.Fragment>;
		});
	};

	const downloadLogs = () => {
		const blob = new Blob([filteredLogs.map((log) => log.message).join("\n")], {
			type: "text/plain;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `xray-logs-${selectedNode || "node"}-${Date.now()}.txt`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	};

	if (getUserIsPending) {
		return <PageLoadingSkeleton />;
	}

	if (!canViewXrayLogs) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				{showTitle && <h1 className="font-semibold text-[1.5rem]">{t("xrayLogs.title")}</h1>}
				<p className="text-[0.875rem] text-panel-text-muted">{t("xrayLogs.noPermission")}</p>
			</div>
		);
	}

	const levelOptions: { value: LevelFilter; label: string }[] = [
		{ value: "all", label: t("xrayLogs.levelAll") },
		{ value: "error", label: t("xrayLogs.levelError") },
		{ value: "warn", label: t("xrayLogs.levelWarn") },
		{ value: "info", label: t("xrayLogs.levelInfo") },
		{ value: "debug", label: t("xrayLogs.levelDebug") },
	];
	const totalLines = logs.length;

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<ListCard
				overview={{
					total: { label: t("xrayLogs.stream"), value: totalLines },
					rows: [
						{ key: "visible", label: t("xrayLogs.visible"), value: filteredLogs.length, tone: "bg-panel-info" },
						{ key: "errors", label: t("xrayLogs.levelError"), value: levelCounts.error, tone: "bg-panel-danger" },
						{ key: "warnings", label: t("xrayLogs.levelWarn"), value: levelCounts.warn, tone: "bg-panel-warning" },
					],
					distribution: {
						label: t("xrayLogs.levels"),
						segments: [
							{ key: "error", label: t("xrayLogs.levelError"), value: levelCounts.error, tone: "bg-panel-danger" },
							{ key: "warn", label: t("xrayLogs.levelWarn"), value: levelCounts.warn, tone: "bg-panel-warning" },
							{ key: "info", label: t("xrayLogs.levelInfo"), value: levelCounts.info, tone: "bg-panel-info" },
							{ key: "debug", label: t("xrayLogs.levelDebug"), value: levelCounts.debug, tone: "bg-panel-text-muted" },
							{ key: "other", label: t("xrayLogs.other"), value: levelCounts.other, tone: "bg-panel-border-strong" },
						],
					},
					extra: {
						label: t("xrayLogs.socket"),
						value: paused ? t("xrayLogs.paused") : socketStatusLabel,
						caption: autoScroll ? t("core.autoScrollOn") : t("core.autoScrollOff"),
					},
				}}
				toolbar={
					<div className="flex flex-col gap-2 xl:flex-row xl:items-center">
						<SearchInput
							containerProps={{ className: "w-full xl:w-[220px]" }}
							placeholder={t("xrayLogs.searchPlaceholder")}
							value={searchFilter}
							onChange={(e) => setSearchFilter(e.target.value)}
							matchOptions={searchMatch}
							onMatchOptionsChange={setSearchMatch}
							onClear={() => {
								setSearchFilter("");
								setSelectedInbound("");
							}}
						/>
						<SegmentedControl<LevelFilter>
							label={t("xrayLogs.levels")}
							value={levelFilter}
							options={levelOptions}
							onChange={(next) => setLevelFilter(next)}
						/>
						<div className="grid grid-cols-2 gap-2 xl:ms-auto xl:flex xl:flex-row xl:items-center">
							<CompactLogSelect
								aria-label={t("xrayLogs.node")}
								onChange={(e) => handleLog(e.target.value)}
								value={selectedNode}
								disabled={!nodes?.length}
							>
								{nodes?.length ? (
									nodes.map((node) => (
										<option key={node.id} value={String(node.id)}>
											{node.name || node.address}
										</option>
									))
								) : (
									<option value="">{t("nodes.noNodes")}</option>
								)}
							</CompactLogSelect>
							<CompactLogSelect
								aria-label={t("xrayLogs.inbound")}
								onChange={(e) => setSelectedInbound(e.target.value)}
								value={selectedInbound}
								disabled={inboundsLoading || inbounds.length === 0}
							>
								<option value="">{t("xrayLogs.allInbounds")}</option>
								{inbounds.map((inbound) => (
									<option key={inbound.tag} value={inbound.tag}>
										{inbound.tag} ({inbound.protocol})
									</option>
								))}
							</CompactLogSelect>
						</div>
					</div>
				}
			/>

			<section className="flex flex-col border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<header className="flex flex-col gap-2 border-b border-panel-border! px-4 py-2.5 md:flex-row md:items-center md:justify-between">
					<div className="flex flex-row flex-wrap items-center gap-2 text-[0.8125rem] text-panel-text-muted">
						<span className={cn("size-2 rounded-full", socketDotClass)} />
						<span>{socketStatusLabel}</span>
						{paused ? <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-200">{t("xrayLogs.paused")}</Badge> : null}
						<span className="tabular-nums">
							{t("xrayLogs.lines")}: {filteredLogs.length} / {totalLines}
						</span>
					</div>
					<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center md:justify-end">
						<Button onClick={() => setWrapLines((value) => !value)} size="xs" variant={wrapLines ? "default" : "outline"}>
							{t("xrayLogs.wrap")}
						</Button>
						<Button onClick={togglePaused} variant="outline" size="xs">
							{paused ? <Play className="w-[14px]" /> : <Pause className="w-[14px]" />}
							{paused ? t("xrayLogs.resume") : t("xrayLogs.pause")}
						</Button>
						<Button disabled={filteredLogs.length === 0} onClick={downloadLogs} variant="outline" size="xs">
							<Download className="w-[14px]" />
							{t("xrayLogs.download")}
						</Button>
						<Button disabled={logs.length === 0} onClick={clearLogs} variant="outline" size="xs">
							<Trash2 className="w-[14px]" />
							{t("clear")}
						</Button>
					</div>
				</header>

				<div className="relative">
					<div ref={logsDiv} className="min-h-[260px] max-h-[560px] overflow-y-auto font-mono">
						{filteredLogs.length === 0 ? (
							<div className="py-10 text-center text-[0.875rem] text-panel-text-muted">
								{searchFilter || levelFilter !== "all" || selectedInbound
									? t("xrayLogs.noMatchingLogs")
									: t("xrayLogs.noLogs")}
							</div>
						) : (
							filteredLogs.map(({ id, message, level }) => {
								const palette = logPalette[level] ?? logPalette.default;
								return (
									<div
										key={id}
										className="grid grid-cols-[3.25rem_auto_minmax(0,1fr)] items-start gap-3 border-b border-panel-border/60 border-s-[3px] px-3 py-1.5 last:border-b-0 hover:bg-panel-row-hover"
										style={{ borderInlineStartColor: palette.border }}
									>
										<span className="select-none pt-0.5 text-end text-[0.6875rem] tabular-nums text-panel-text-muted">{id + 1}</span>
										<span
											className="mt-0.5 inline-flex justify-center rounded px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wide"
											style={{ backgroundColor: palette.bg, color: palette.color }}
										>
											{LEVEL_LABELS[level]}
										</span>
										<pre
											className={cn(
												"m-0 font-mono text-[0.8125rem] leading-5 text-panel-text",
												wrapLines ? "whitespace-pre-wrap break-all" : "overflow-x-auto whitespace-pre",
											)}
										>
											{renderMessage(id, message)}
										</pre>
									</div>
								);
							})
						)}
					</div>
					{!autoScroll && filteredLogs.length > 0 ? (
						<Button onClick={scrollToLatest} size="xs" className="absolute bottom-3 end-3 shadow-md">
							<ChevronsDown className="w-[14px]" />
							{t("xrayLogs.jumpToLatest")}
						</Button>
					) : null}
				</div>
			</section>
		</div>
	);
};

export default XrayLogsPage;
