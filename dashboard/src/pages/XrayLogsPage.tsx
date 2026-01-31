import {
	Box,
	chakra,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	InputRightElement,
	Select,
	Stack,
	Text,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { joinPaths } from "@remix-run/router";
import { useNodesQuery } from "contexts/NodesContext";
import useGetUser from "hooks/useGetUser";
import { debounce } from "lodash";
import React, {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import useWebSocket from "react-use-websocket";
import { fetch } from "service/http";
import { getAuthToken } from "utils/authStorage";
import type { RawInbound } from "utils/inbounds";

const MAX_NUMBER_OF_LOGS = 500;

const getWebsocketUrl = (nodeID: string) => {
	try {
		const baseURL = new URL(
			import.meta.env.VITE_BASE_API.startsWith("/")
				? window.location.origin + import.meta.env.VITE_BASE_API
				: import.meta.env.VITE_BASE_API,
		);

		return (
			(baseURL.protocol === "https:" ? "wss://" : "ws://") +
			joinPaths([
				baseURL.host + baseURL.pathname,
				!nodeID ? "/core/logs" : `/node/${nodeID}/logs`,
			]) +
			"?interval=1&token=" +
			getAuthToken()
		);
	} catch (e) {
		console.error("Unable to generate websocket url");
		console.error(e);
		return null;
	}
};

interface XrayLogsPageProps {
	showTitle?: boolean;
}

export const XrayLogsPage: FC<XrayLogsPageProps> = ({ showTitle = true }) => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewXrayLogs =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const { data: nodes } = useNodesQuery({ enabled: canViewXrayLogs });
	const [selectedNode, setNode] = useState<string>("");
	const [logs, setLogs] = useState<string[]>([]);
	const [searchFilter, setSearchFilter] = useState<string>("");
	const [selectedInbound, setSelectedInbound] = useState<string>("");
	const [inbounds, setInbounds] = useState<RawInbound[]>([]);
	const [inboundsLoading, setInboundsLoading] = useState(false);
	const logsDiv = useRef<HTMLDivElement | null>(null);
	const [autoScroll, setAutoScroll] = useState(true);
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
		if (!id) {
			setNode("");
			setLogs([]);
			return;
		}
		setNode(id);
		setLogs([]);
	};

	const appendLog = useCallback(
		debounce((line: string) => {
			setLogs((prev) => {
				const next =
					prev.length >= MAX_NUMBER_OF_LOGS
						? [...prev.slice(prev.length - MAX_NUMBER_OF_LOGS + 1), line]
						: [...prev, line];
				return next;
			});
		}, 50),
		[],
	);

	useEffect(() => {
		return () => {
			appendLog.cancel();
		};
	}, [appendLog]);

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
			const threshold = 32;
			const isAtBottom =
				element.scrollHeight - element.scrollTop - element.clientHeight <=
				threshold;
			setAutoScroll(isAtBottom);
		};
		element.addEventListener("scroll", handleScroll);
		handleScroll();
		return () => {
			element.removeEventListener("scroll", handleScroll);
		};
	}, []);

	useEffect(() => {
		if (autoScroll && logsDiv.current) {
			logsDiv.current.scrollTop = logsDiv.current.scrollHeight;
		}
	}, [autoScroll]);

	const logPalette = useMemo(() => {
		const isDark = colorMode === "dark";
		return {
			error: {
				bg: isDark ? "rgba(239, 68, 68, 0.2)" : "rgba(254, 226, 226, 0.8)",
				color: isDark ? "#fca5a5" : "#dc2626",
				border: isDark ? "#ef4444" : "#dc2626",
			},
			warn: {
				bg: isDark ? "rgba(234, 179, 8, 0.2)" : "rgba(254, 243, 199, 0.8)",
				color: isDark ? "#fde047" : "#ca8a04",
				border: isDark ? "#eab308" : "#facc15",
			},
			success: {
				bg: isDark ? "rgba(34, 197, 94, 0.2)" : "rgba(209, 250, 229, 0.8)",
				color: isDark ? "#86efac" : "#16a34a",
				border: isDark ? "#22c55e" : "#22c55e",
			},
			info: {
				bg: isDark ? "rgba(59, 130, 246, 0.2)" : "rgba(219, 234, 254, 0.85)",
				color: isDark ? "#93c5fd" : "#2563eb",
				border: isDark ? "#3b82f6" : "#3b82f6",
			},
			debug: {
				bg: isDark ? "rgba(148, 163, 184, 0.16)" : "rgba(241, 245, 249, 0.8)",
				color: isDark ? "#cbd5e1" : "#475569",
				border: isDark ? "#94a3b8" : "#94a3b8",
			},
			default: {
				bg: isDark ? "rgba(51, 65, 85, 0.1)" : "rgba(248, 250, 252, 0.8)",
				color: isDark ? "#e2e8f0" : "#64748b",
				border: isDark ? "#475569" : "#cbd5e1",
			},
		};
	}, [colorMode]);

	const containerBg = useColorModeValue("#f5f7fb", "#1f2329");
	const containerBorder = useColorModeValue("gray.200", "gray.600");
	const badgeColor = useColorModeValue("gray.500", "gray.400");
	const selectBg = useColorModeValue("white", "gray.700");
	const inputBg = useColorModeValue("white", "gray.700");

	// Get selected inbound tag
	const selectedInboundTag = useMemo(() => {
		if (!selectedInbound) return null;
		const inbound = inbounds.find((inv) => inv.tag === selectedInbound);
		return inbound?.tag || null;
	}, [selectedInbound, inbounds]);

	// Filter logs based on search and inbound
	const filteredLogs = useMemo(() => {
		let filtered = logs;

		// Filter by inbound tag if selected
		if (selectedInboundTag) {
			filtered = filtered.filter((log) => {
				const logLower = log.toLowerCase();
				return logLower.includes(selectedInboundTag.toLowerCase());
			});
		}

		// Filter by search text if provided
		if (searchFilter.trim()) {
			const filterLower = searchFilter.toLowerCase();
			filtered = filtered.filter((log) =>
				log.toLowerCase().includes(filterLower),
			);
		}

		return filtered;
	}, [logs, searchFilter, selectedInboundTag]);

	const logEntries = useMemo(
		() =>
			filteredLogs.map((message, idx) => ({
				message,
				key: `${idx}-${message}`,
			})),
		[filteredLogs],
	);

	const SearchIcon = chakra(MagnifyingGlassIcon, {
		baseStyle: {
			w: 4,
			h: 4,
			color: badgeColor,
		},
	});

	const ClearIcon = chakra(XMarkIcon, {
		baseStyle: {
			w: 4,
			h: 4,
		},
	});

	const classifyLog = (message: string) => {
		const lowerMessage = message.toLowerCase();
		// Prefer explicit Xray level markers when present: [Info], [Warning], [Error], ...
		const explicitMatch = message.match(
			/\[(debug|info|warning|warn|error|fatal|panic|critical)\]/i,
		);
		if (explicitMatch?.[1]) {
			const explicit = explicitMatch[1].toLowerCase();
			if (["error", "fatal", "panic", "critical"].includes(explicit)) {
				return "error" as const;
			}
			if (["warning", "warn"].includes(explicit)) {
				return "warn" as const;
			}
			if (explicit === "debug") {
				return "debug" as const;
			}
			return "info" as const;
		}

		// Startup banners and successful starts should be green/success.
		if (
			/^xray\s+\d+/i.test(message) ||
			/unified platform for anti-censorship/i.test(lowerMessage) ||
			/core:\s*xray.*started/i.test(lowerMessage)
		) {
			return "success" as const;
		}

		// Check for error patterns first (most critical)
		if (/error|failed|exception|fatal|panic|critical/i.test(lowerMessage)) {
			return "error" as const;
		}
		// Check for warning patterns
		if (/warn|warning|deprecated/i.test(lowerMessage)) {
			return "warn" as const;
		}
		// Check for success/info patterns
		if (/success|connected|started|stopped/i.test(lowerMessage)) {
			return "success" as const;
		}
		if (/info|information/i.test(lowerMessage)) {
			return "info" as const;
		}
		// Check for debug patterns
		if (/debug|trace|verbose/i.test(lowerMessage)) {
			return "debug" as const;
		}
		return "default" as const;
	};

	if (!canViewXrayLogs) {
		return (
			<VStack spacing={4} align="stretch">
				{showTitle && (
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("xrayLogs.title", "Xray logs")}
					</Text>
				)}
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"xrayLogs.noPermission",
						"You do not have permission to view Xray logs.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={6} align="stretch">
			{showTitle && (
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("header.xrayLogs")}
				</Text>
			)}
			<Stack
				direction={{ base: "column", sm: "row" }}
				spacing={{ base: 3, sm: 4 }}
				align={{ base: "stretch", sm: "center" }}
				justify="space-between"
			>
				<Stack
					direction={{ base: "column", sm: "row" }}
					spacing={3}
					align={{ base: "stretch", sm: "center" }}
					flex={1}
				>
					{nodes?.[0] && (
						<Select
							size="sm"
							w={{ base: "full", sm: "auto" }}
							bg={selectBg}
							onChange={(e) => handleLog(e.target.value)}
							value={selectedNode}
						>
							<option value="">{t("core.master")}</option>
							{nodes.map((s) => (
								<option key={s.address} value={String(s.id)}>
									{t(s.name)}
								</option>
							))}
						</Select>
					)}
					<Select
						size="sm"
						w={{ base: "full", sm: "200px" }}
						bg={selectBg}
						onChange={(e) => setSelectedInbound(e.target.value)}
						value={selectedInbound}
						placeholder={t("xrayLogs.selectInbound", "Select Inbound")}
						isDisabled={inboundsLoading || inbounds.length === 0}
					>
						<option value="">
							{t("xrayLogs.allInbounds", "All Inbounds")}
						</option>
						{inbounds.map((inbound) => (
							<option key={inbound.tag} value={inbound.tag}>
								{inbound.tag} ({inbound.protocol})
							</option>
						))}
					</Select>
					<InputGroup
						size="sm"
						maxW={{ base: "full", sm: "300px" }}
						bg={inputBg}
					>
						<InputLeftElement pointerEvents="none">
							<SearchIcon />
						</InputLeftElement>
						<Input
							placeholder={t(
								"xrayLogs.searchPlaceholder",
								"Search logs (UUID, username, email, inbound tag...)",
							)}
							value={searchFilter}
							onChange={(e) => setSearchFilter(e.target.value)}
						/>
						{(searchFilter || selectedInbound) && (
							<InputRightElement>
								<IconButton
									aria-label="Clear filters"
									size="xs"
									variant="ghost"
									onClick={() => {
										setSearchFilter("");
										setSelectedInbound("");
									}}
									icon={<ClearIcon />}
								/>
							</InputRightElement>
						)}
					</InputGroup>
					<Text fontSize="sm" color={badgeColor} whiteSpace="nowrap">
						{t(`core.socket.${readyState}`)}
					</Text>
				</Stack>
				<Stack direction="row" spacing={2} align="center">
					{(searchFilter || selectedInbound) && (
						<Text fontSize="xs" color={badgeColor} whiteSpace="nowrap">
							{t("xrayLogs.filteredCount", "{{count}} of {{total}} logs", {
								count: filteredLogs.length,
								total: logs.length,
							})}
						</Text>
					)}
					<Text fontSize="xs" color={badgeColor} whiteSpace="nowrap">
						{autoScroll
							? t("core.autoScrollOn", "Auto-scroll: On")
							: t("core.autoScrollOff", "Auto-scroll: Off")}
					</Text>
				</Stack>
			</Stack>
			<Box
				border="1px solid"
				borderColor={containerBorder}
				bg={containerBg}
				borderRadius="lg"
				minHeight="200px"
				maxHeight="500px"
				p={3}
				overflowY="auto"
				ref={logsDiv}
				fontFamily="mono"
				fontSize="sm"
			>
				<VStack align="stretch" spacing={2}>
					{filteredLogs.length === 0 ? (
						<Box textAlign="center" py={8} color={badgeColor} fontSize="sm">
							{searchFilter
								? t(
										"xrayLogs.noMatchingLogs",
										"No logs match your search filter",
									)
								: t("xrayLogs.noLogs", "No logs available")}
						</Box>
					) : (
						logEntries.map(({ message, key }) => {
							const level = classifyLog(message);
							const palette = logPalette[level] ?? logPalette.default;
							// Highlight search term in the log message
							const highlightMessage = searchFilter
								? (() => {
										const parts = message.split(
											new RegExp(
												`(${searchFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
												"gi",
											),
										);
										const partsWithKeys = parts.map((part, idx) => ({
											part,
											key: `${key}-part-${idx}`,
										}));
										return partsWithKeys.map(({ part, key: partKey }) => {
											if (part.toLowerCase() === searchFilter.toLowerCase()) {
												return (
													<chakra.span
														key={partKey}
														bg="yellow.300"
														color="black"
														px={1}
														borderRadius="sm"
														fontWeight="semibold"
														_dark={{ bg: "yellow.500", color: "black" }}
													>
														{part}
													</chakra.span>
												);
											}
											return (
												<React.Fragment key={partKey}>{part}</React.Fragment>
											);
										});
									})()
								: message;
							return (
								<Box
									key={key}
									bg={palette.bg}
									color={palette.color}
									borderLeftWidth={3}
									borderLeftColor={palette.border}
									px={3}
									py={2}
									borderRadius="md"
									boxShadow="sm"
									_dark={{ boxShadow: "none" }}
								>
									<chakra.pre
										m={0}
										whiteSpace="pre-wrap"
										wordBreak="break-word"
									>
										{highlightMessage}
									</chakra.pre>
								</Box>
							);
						})
					)}
				</VStack>
			</Box>
		</VStack>
	);
};

export default XrayLogsPage;
