const HistoryModal: FC<{
	isOpen: boolean;
	onClose: () => void;
	payload: HistoryModalPayload | null;
	intervalSeconds: number;
	onIntervalChange: (value: number) => void;
	t: TFunction;
}> = ({ isOpen, onClose, payload, intervalSeconds, onIntervalChange, t }) => {
	const { colorMode } = useColorMode();
	const gridColor = useColorModeValue("rgba(0, 0, 0, 0.08)", "rgba(255, 255, 255, 0.08)");
	const mutedTextColor = useColorModeValue("#64748b", "#8a8a8a");

	const latestTimestamp = useMemo(() => {
		if (!payload) return Math.floor(Date.now() / 1000);
		const extractLatest = (entries: Array<{ timestamp: number }>) =>
			entries.length ? entries[entries.length - 1].timestamp : null;
		if (payload.type === "network") {
			return extractLatest(payload.entries) ?? Math.floor(Date.now() / 1000);
		}
		if (payload.type === "panel") {
			return (
				extractLatest(payload.cpuEntries) ??
				extractLatest(payload.memoryEntries) ??
				Math.floor(Date.now() / 1000)
			);
		}
		return extractLatest(payload.entries) ?? Math.floor(Date.now() / 1000);
	}, [payload]);

	const cutoff = latestTimestamp - intervalSeconds;

	const filteredStandardEntries = useMemo(() => {
		if (!payload || payload.type === "network" || payload.type === "panel") {
			return [];
		}
		const entries = payload.entries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredNetworkEntries = useMemo(() => {
		if (!payload || payload.type !== "network") {
			return [];
		}
		const entries = payload.entries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredPanelCpu = useMemo(() => {
		if (!payload || payload.type !== "panel") return [];
		const entries = payload.cpuEntries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const filteredPanelMemory = useMemo(() => {
		if (!payload || payload.type !== "panel") return [];
		const entries = payload.memoryEntries
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const filtered = entries.filter((entry) => entry.timestamp >= cutoff);
		return filtered.length ? filtered : entries;
	}, [payload, cutoff]);

	const chartSeries = useMemo(() => {
		if (!payload) {
			return [];
		}
		if (payload.type === "network") {
			return [
				{
					name: t("networkIncoming"),
					data: filteredNetworkEntries.map((entry) => [
						entry.timestamp * 1000,
						entry.incoming,
					]),
				},
				{
					name: t("networkOutgoing"),
					data: filteredNetworkEntries.map((entry) => [
						entry.timestamp * 1000,
						entry.outgoing,
					]),
				},
			];
		}
		if (payload.type === "panel") {
			return [
				{
					name: t("cpuUsage"),
					data: filteredPanelCpu.map((entry) => [
						entry.timestamp * 1000,
						entry.value,
					]),
				},
				{
					name: t("memoryUsage"),
					data: filteredPanelMemory.map((entry) => [
						entry.timestamp * 1000,
						entry.value,
					]),
				},
			];
		}
		return [
			{
				name: payload.metricLabel,
				data: filteredStandardEntries.map((entry) => [
					entry.timestamp * 1000,
					entry.value,
				]),
			},
		];
	}, [
		filteredStandardEntries,
		filteredNetworkEntries,
		filteredPanelCpu,
		filteredPanelMemory,
		payload,
		t,
	]);

	const options = useMemo(
		() => ({
			chart: {
				type: "area" as const,
				animations: { enabled: false },
				toolbar: { show: false },
				zoom: { enabled: false },
				background: "transparent",
				fontFamily: "inherit",
			},
			colors: ["#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e"],
			fill: {
				type: "gradient",
				gradient: {
					shadeIntensity: 1,
					opacityFrom: 0.3,
					opacityTo: 0.0,
					stops: [0, 100],
				},
			},
			dataLabels: { enabled: false },
			theme: { mode: colorMode },
			stroke: {
				curve: "smooth" as const,
				width: 2,
			},
			grid: {
				borderColor: gridColor,
				strokeDashArray: 4,
				xaxis: { lines: { show: false } },
				yaxis: { lines: { show: true } },
				padding: { top: 10, right: 10, bottom: 0, left: 10 },
			},
			xaxis: {
				type: "datetime" as const,
				axisBorder: { show: false },
				axisTicks: { show: false },
				labels: {
					style: { colors: mutedTextColor, fontSize: "11px", fontFamily: "inherit" },
					datetimeFormatter: { hour: "HH:mm" },
				},
				tooltip: { enabled: false },
			},
			yaxis: {
				decimalsInFloat: 0,
				labels: {
					style: { colors: mutedTextColor, fontSize: "11px", fontFamily: "inherit", fontWeight: 500 },
				},
			},
			legend: {
				position: "bottom" as const,
				horizontalAlign: "center" as const,
				offsetY: 8,
				markers: { radius: 12 },
				labels: { colors: mutedTextColor },
				itemMargin: { horizontal: 10, vertical: 0 },
			},
			tooltip: {
				theme: colorMode,
				x: { format: "HH:mm:ss" },
				style: { fontSize: "12px", fontFamily: "inherit" },
			},
		}),
		[colorMode, gridColor, mutedTextColor],
	);

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
			<ModalOverlay bg="blackAlpha.500" backdropFilter="blur(4px)" />
			<ModalContent bg="panel.surface" borderWidth="1px" borderColor="panel.border" borderRadius="2xl">
				<ModalHeader
					display="flex"
					alignItems="center"
					justifyContent="space-between"
					px={6}
					py={4}
					borderBottomWidth="1px"
					borderColor="panel.border"
					fontSize="md"
					fontWeight="bold"
				>
					<Text>{t("historyModalTitle", { metric: payload?.title ?? "" })}</Text>
					<ModalCloseButton position="static" insetInlineEnd="auto" />
				</ModalHeader>
				<ModalBody px={6} py={5}>
					<Stack spacing={5}>
						<Flex wrap="wrap" gap={2}>
							{HISTORY_INTERVALS.map((interval) => (
								<Button
									key={interval.seconds}
									size="sm"
									borderRadius="full"
									variant={
										intervalSeconds === interval.seconds ? "solid" : "outline"
									}
									colorScheme={intervalSeconds === interval.seconds ? "primary" : "gray"}
									onClick={() => onIntervalChange(interval.seconds)}
								>
									{t(interval.labelKey)}
								</Button>
							))}
						</Flex>
						<Box
							key={`chart-interval-box-${intervalSeconds}`}
							mx="-10px"
							sx={{
								"@keyframes subtleFadeIn": {
									from: { opacity: 0.65 },
									to: { opacity: 1 },
								},
								animation: "subtleFadeIn 0.2s ease-out",
								"@media (prefers-reduced-motion: reduce)": {
									animation: "none",
								},
							}}
						>
							<Chart
								key={`chart-interval-${intervalSeconds}`}
								options={options}
								series={chartSeries}
								type="area"
								height={300}
							/>
						</Box>
					</Stack>
				</ModalBody>
				<ModalFooter px={6} py={4} borderTopWidth="1px" borderColor="panel.border">
					<Button onClick={onClose} borderRadius="full" variant="ghost" size="sm">
						{t("close")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
