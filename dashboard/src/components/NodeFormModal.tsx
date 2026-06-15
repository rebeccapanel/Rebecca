import {
	Box,
	Button,
	Checkbox,
	Collapse,
	chakra,
	FormControl,
	FormErrorMessage,
	FormLabel,
	HStack,
	IconButton,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Tag,
	Text,
	Textarea,
	Tooltip,
	useClipboard,
	useToast,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	DocumentDuplicateIcon,
	EyeIcon,
	EyeSlashIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	getNodeDefaultValues,
	NodeSchema,
	type NodeType,
	useNodes,
} from "contexts/NodesContext";
import dayjs from "dayjs";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { getPanelSettings } from "service/settings";
import { SizeFormatter } from "../utils/outbound";
import {
	AnimatedSubmitButton,
	type AnimatedSubmitStatus,
} from "./common/AnimatedSubmitButton";
import { Input } from "./Input";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";
import { NodeModalStatusBadge } from "./NodeModalStatusBadge";

const EyeIconStyled = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const EyeSlashIconStyled = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });
const CopyIconStyled = chakra(DocumentDuplicateIcon, {
	baseStyle: { w: 4, h: 4 },
});
const DownloadIconStyled = chakra(ArrowDownTrayIcon, {
	baseStyle: { w: 4, h: 4 },
});

const BYTES_IN_GB = 1024 * 1024 * 1024;
const DEFAULT_NOBETCI_PORT = 51031;

const getInputError = (error: unknown): string | undefined => {
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		return typeof message === "string" ? message : undefined;
	}
	return undefined;
};

const uniqueValues = (items: string[]): string[] =>
	Array.from(new Set(items.filter(Boolean)));

const getConfigInbounds = (config: NodeType["xray_config"]): string[] => {
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return [];
	}

	const inbounds = (config as { inbounds?: unknown }).inbounds;
	if (!Array.isArray(inbounds)) {
		return [];
	}

	return inbounds
		.map((inbound) => {
			if (!inbound || typeof inbound !== "object") {
				return "";
			}
			const item = inbound as { tag?: unknown; remark?: unknown };
			return typeof item.tag === "string" && item.tag
				? item.tag
				: typeof item.remark === "string" && item.remark
					? item.remark
					: "inbound";
		})
		.filter(Boolean);
};

const formatNodeBytes = (value?: number | null) =>
	value !== null && value !== undefined ? SizeFormatter.sizeFormat(value) : "-";

const formatNodeSpeed = (value?: number | null) =>
	value !== null && value !== undefined ? `${SizeFormatter.sizeFormat(value)}/s` : "-";

const formatNodePercent = (value?: number | null) =>
	value !== null && value !== undefined && Number.isFinite(value)
		? `${Math.round(value * 10) / 10}%`
		: "-";

const formatCPUFrequency = (value?: number | null) => {
	if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
		return "-";
	}
	return `${Math.round((value / 1_000_000_000) * 100) / 100} GHz`;
};

const buildNodeInstallBundle = (
	certificate?: string | null,
	certificateKey?: string | null,
) => {
	const cert = certificate?.trim() ?? "";
	const key = certificateKey?.trim() ?? "";
	if (cert && key) {
		return `${cert}\n${key}\n`;
	}
	return cert;
};

const OverviewItem: FC<{
	detail?: ReactNode;
	label: ReactNode;
	value: ReactNode;
}> = ({ detail, label, value }) => (
	<Box>
		<Text fontSize="xs" textTransform="uppercase" color="gray.500">
			{label}
		</Text>
		<Box fontWeight="medium" lineHeight="short" mt={0.5}>
			{value}
		</Box>
		{detail && (
			<Text fontSize="xs" color="gray.500" mt={1}>
				{detail}
			</Text>
		)}
	</Box>
);

interface NodeFormModalProps {
	isOpen: boolean;
	onClose: () => void;
	node?: NodeType;
	defaultInboundTags?: string[];
	mutate: (
		data: any,
		options?: {
			onError?: (error: unknown) => void;
			onSuccess?: (data: NodeType) => void;
		},
	) => void;
	isLoading: boolean;
	isAddMode?: boolean;
	onSubmitSuccess?: (node: NodeType) => void;
}

export const NodeFormModal: FC<NodeFormModalProps> = ({
	isOpen,
	onClose,
	node,
	defaultInboundTags = [],
	mutate,
	isLoading,
	isAddMode = false,
	onSubmitSuccess,
}) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [showCertificate, setShowCertificate] = useState(false);
	const { fetchNodesUsage } = useNodes();
	const [nodeUsage, setNodeUsage] = useState<{
		uplink: number;
		downlink: number;
	} | null>(null);
	const [submitStatus, setSubmitStatus] =
		useState<AnimatedSubmitStatus>("idle");
	const submitResetTimerRef = useRef<number | null>(null);
	const successCloseTimerRef = useRef<number | null>(null);

	const { data: panelSettings } = useQuery({
		queryKey: "panel-settings",
		queryFn: getPanelSettings,
		staleTime: 5 * 60 * 1000,
	});

	const allowNobetci = panelSettings?.use_nobetci ?? true;

	const formatDataLimitForInput = useCallback((value?: number | null) => {
		if (value === null || value === undefined) {
			return null;
		}
		const gbValue = value / BYTES_IN_GB;
		if (!Number.isFinite(gbValue)) {
			return null;
		}
		const rounded = Math.round(gbValue * 100) / 100;
		return rounded;
	}, []);

	const convertLimitToBytes = (value?: number | null) =>
		value === null || value === undefined
			? null
			: Math.round(value * BYTES_IN_GB);

	const baseDefaults = isAddMode
		? getNodeDefaultValues()
		: {
				...getNodeDefaultValues(),
				...node,
			};

	const form = useForm({
		resolver: zodResolver(NodeSchema),
		defaultValues: {
			...baseDefaults,
			data_limit: formatDataLimitForInput(baseDefaults.data_limit ?? null),
		},
	});

	const nodeCertificateValue = !isAddMode
		? buildNodeInstallBundle(node?.node_certificate, node?.node_certificate_key)
		: "";
	const { onCopy: copyNodeCertificate, hasCopied: nodeCertificateCopied } =
		useClipboard(nodeCertificateValue);
	const useNobetci = form.watch("use_nobetci");
	const proxyEnabled = form.watch("proxy_enabled");
	const overviewInboundTags = useMemo(() => {
		const customInbounds = uniqueValues(getConfigInbounds(node?.xray_config));
		return customInbounds.length ? customInbounds : defaultInboundTags;
	}, [defaultInboundTags, node?.xray_config]);
	const nodeStatus = node?.status || "error";
	const nodeUsageTotal = (node?.uplink ?? 0) + (node?.downlink ?? 0);
	const nodeUsagePeriodTotal =
		nodeUsage !== null ? nodeUsage.uplink + nodeUsage.downlink : null;
	const nodeLimitDisplay =
		node?.data_limit !== null &&
		node?.data_limit !== undefined &&
		node.data_limit > 0
			? formatNodeBytes(node.data_limit)
			: t("nodes.unlimited", "Unlimited");
	const nodeRuntimeVersion =
		node?.node_binary_tag || node?.node_service_version || "";
	const nodeInstallLabel =
		[node?.node_install_mode, node?.node_update_channel]
			.filter(Boolean)
			.join(" / ") || "-";
	const certificateState = node?.uses_default_certificate
		? t("nodes.legacyCertificate", "Legacy shared")
		: node?.has_custom_certificate
			? t("nodes.privateCertificate", "Private")
			: "-";

	const clearSubmitTimers = useCallback(() => {
		if (submitResetTimerRef.current !== null) {
			window.clearTimeout(submitResetTimerRef.current);
			submitResetTimerRef.current = null;
		}
		if (successCloseTimerRef.current !== null) {
			window.clearTimeout(successCloseTimerRef.current);
			successCloseTimerRef.current = null;
		}
	}, []);

	useEffect(() => clearSubmitTimers, [clearSubmitTimers]);

	const showSubmitError = useCallback(() => {
		if (successCloseTimerRef.current !== null) {
			window.clearTimeout(successCloseTimerRef.current);
			successCloseTimerRef.current = null;
		}
		if (submitResetTimerRef.current !== null) {
			window.clearTimeout(submitResetTimerRef.current);
		}
		setSubmitStatus("error");
		submitResetTimerRef.current = window.setTimeout(() => {
			setSubmitStatus("idle");
			submitResetTimerRef.current = null;
		}, 900);
	}, []);

	useEffect(() => {
		if (!allowNobetci || !useNobetci) {
			if (form.getValues("nobetci_port") !== null) {
				form.setValue("nobetci_port", null);
			}
			return;
		}
		const currentPort = form.getValues("nobetci_port");
		if (currentPort === null || currentPort === undefined) {
			form.setValue("nobetci_port", DEFAULT_NOBETCI_PORT);
		}
	}, [useNobetci, form, allowNobetci]);

	useEffect(() => {
		if (panelSettings && !panelSettings.use_nobetci) {
			if (form.getValues("use_nobetci")) {
				form.setValue("use_nobetci", false);
			}
			if (form.getValues("nobetci_port") !== null) {
				form.setValue("nobetci_port", null);
			}
		}
	}, [panelSettings, form]);

	useEffect(() => {
		if (!proxyEnabled) {
			return;
		}
		const currentType = form.getValues("proxy_type");
		if (!currentType) {
			form.setValue("proxy_type", "http");
		}
	}, [proxyEnabled, form]);

	useEffect(() => {
		if (isOpen) {
			clearSubmitTimers();
			setSubmitStatus("idle");
			const defaults = isAddMode
				? getNodeDefaultValues()
				: {
						...getNodeDefaultValues(),
						...node,
					};
			form.reset({
				...defaults,
				data_limit: formatDataLimitForInput(defaults.data_limit ?? null),
			});
			setShowCertificate(!isAddMode && !!node?.node_certificate);
		}
	}, [isOpen, isAddMode, node, form, formatDataLimitForInput, clearSubmitTimers]);

	useEffect(() => {
		if (!isAddMode && node && isOpen) {
			if (node.id === null || node.id === undefined) {
				setNodeUsage(null);
				return;
			}
			const nodeId = String(node.id);
			fetchNodesUsage({
				start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00"),
			}).then(
				(data: {
					usages?: Record<string, { uplink?: number; downlink?: number }>;
				}) => {
					const usage = data.usages?.[nodeId];
					if (usage) {
						setNodeUsage({
							uplink: usage.uplink ?? 0,
							downlink: usage.downlink ?? 0,
						});
					} else {
						setNodeUsage(null);
					}
				},
			);
		} else {
			setNodeUsage(null);
		}
	}, [node, isAddMode, isOpen, fetchNodesUsage]);

	const handleSubmit = form.handleSubmit((data) => {
		if (submitStatus !== "idle" || isLoading) return;
		clearSubmitTimers();
		setSubmitStatus("loading");
		const payload = {
			...data,
			data_limit: convertLimitToBytes(data.data_limit ?? null),
		};
		mutate(payload, {
			onError: () => {
				showSubmitError();
			},
			onSuccess: (createdOrUpdatedNode) => {
				setSubmitStatus("success");
				successCloseTimerRef.current = window.setTimeout(() => {
					successCloseTimerRef.current = null;
					handleClose();
					window.setTimeout(() => {
						onSubmitSuccess?.(createdOrUpdatedNode);
					}, 0);
				}, 1000);
			},
		});
	}, () => {
		if (submitStatus !== "idle") return;
		showSubmitError();
	});

	const handleCopyNodeCertificate = () => {
		if (!nodeCertificateValue) return;
		copyNodeCertificate();
		toast({
			title: t("copied"),
			status: "success",
			isClosable: true,
			position: "top",
			duration: 2000,
		});
	};

	const handleDownloadNodeCertificate = () => {
		if (!nodeCertificateValue) return;
		const blob = new Blob([nodeCertificateValue], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "node_install_bundle.pem";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	function handleClose() {
		clearSubmitTimers();
		setSubmitStatus("idle");
		setShowCertificate(false);
		setNodeUsage(null);
		onClose();
	}

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			size="2xl"
			scrollBehavior="inside"
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent
				mx="3"
				as="form"
				onSubmit={handleSubmit}
				sx={{
					".node-form-section .chakra-simple-grid": {
						gridTemplateColumns: {
							base: "1fr",
							md: "repeat(2, minmax(0, 1fr))",
						},
					},
					".node-form-section .chakra-form-control": {
						display: "block",
					},
					".node-form-section .node-switch-control": {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 3,
					},
					".node-form-section .chakra-form__label": {
						mb: 1,
					},
					".node-form-section .chakra-input__group, .node-form-section .chakra-numberinput, .node-form-section input, .node-form-section select":
						{
							w: "full",
							width: "100%",
						},
					".node-form-section .chakra-form-control > .chakra-form__helper-text, .node-form-section .chakra-form-control > .chakra-form__error-message":
						{
							gridColumn: "auto",
						},
				}}
			>
				<XrayModalHeader>
					{isAddMode ? t("nodes.addNewRebeccaNode") : t("nodes.editNode")}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<Stack spacing={4}>
						{!isAddMode && node && (
							<Stack className="xray-dialog-section" spacing={4}>
								<HStack justify="space-between" align="flex-start" gap={3}>
									<VStack align="flex-start" spacing={1} minW={0}>
										<Text fontWeight="semibold">
											{t("nodes.overview", "Node overview")}
										</Text>
										<Text
											fontSize="xs"
											color="gray.500"
											noOfLines={2}
											wordBreak="break-word"
										>
											{node.name || t("nodes.unnamedNode", "Unnamed node")} ·{" "}
											{t("nodes.id", "ID")}: {node.id ?? "-"}
										</Text>
										{node.note && (
											<Text
												fontSize="xs"
												color="gray.500"
												noOfLines={3}
												wordBreak="break-word"
											>
												{node.note}
											</Text>
										)}
									</VStack>
									<NodeModalStatusBadge status={nodeStatus} compact />
								</HStack>
								{node.message && (
									<Box
										borderWidth="1px"
										borderColor="red.200"
										borderRadius="md"
										bg="red.50"
										color="red.700"
										px={3}
										py={2}
										_dark={{
											bg: "red.900",
											borderColor: "red.700",
											color: "red.100",
										}}
									>
										<Text fontSize="sm">{node.message}</Text>
									</Box>
								)}
								<SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={3}>
									<OverviewItem
										label={t("nodes.nodeAddress", "Address")}
										value={
											<Text as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
												{node.address || "-"}
											</Text>
										}
										detail={`${t("nodes.nodePort", "Port")}: ${
											node.port ?? "-"
										} · ${t("nodes.nodeAPIPort", "API port")}: ${
											node.api_port ?? "-"
										}`}
									/>
									<OverviewItem
										label={t("nodes.trafficLimit", "Traffic / Limit")}
										value={`${formatNodeBytes(nodeUsageTotal)} / ${nodeLimitDisplay}`}
										detail={`${t("nodes.uplink", "Uplink")}: ${formatNodeBytes(
											node.uplink,
										)} · ${t("nodes.downlink", "Downlink")}: ${formatNodeBytes(
											node.downlink,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.usageLast30Days", "Last 30 days")}
										value={
											nodeUsagePeriodTotal !== null
												? formatNodeBytes(nodeUsagePeriodTotal)
												: "-"
										}
										detail={
											nodeUsage
												? `${t("nodes.uplink", "Uplink")}: ${formatNodeBytes(
														nodeUsage.uplink,
													)} · ${t("nodes.downlink", "Downlink")}: ${formatNodeBytes(
														nodeUsage.downlink,
													)}`
												: t("nodes.usageUnavailable", "Usage data unavailable")
										}
									/>
									<OverviewItem
										label={t("nodes.bandwidthSpeed", "Upload / Download")}
										value={`${formatNodeSpeed(node.upload_speed)} / ${formatNodeSpeed(
											node.download_speed,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.cpu", "CPU")}
										value={formatNodePercent(node.cpu_usage_percent)}
										detail={`${node.cpu_cores ?? "-"} ${t(
											"cores",
											"cores",
										)} · ${formatCPUFrequency(node.cpu_frequency_hz)}`}
									/>
									<OverviewItem
										label={t("nodes.ram", "RAM")}
										value={formatNodePercent(node.memory_usage_percent)}
										detail={`${formatNodeBytes(node.memory_used)} / ${formatNodeBytes(
											node.memory_total,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.runtime", "Runtime")}
										value={
											node.xray_version
												? `Xray ${node.xray_version}`
												: t("nodes.versionUnknown", "Version unknown")
										}
										detail={
											nodeRuntimeVersion
												? `${t("nodes.nodeServiceVersionTag", {
														version: nodeRuntimeVersion,
													})} · ${nodeInstallLabel}`
												: nodeInstallLabel
										}
									/>
									<OverviewItem
										label={t("nodes.certificate", "Certificate")}
										value={
											<Tag
												size="sm"
												colorScheme={
													node.uses_default_certificate
														? "orange"
														: node.has_custom_certificate
															? "green"
															: "gray"
												}
											>
												{certificateState}
											</Tag>
										}
									/>
								</SimpleGrid>
								<Box>
									<Text fontSize="xs" textTransform="uppercase" color="gray.500">
										{t("nodes.inbounds", "Inbounds")}
									</Text>
									{overviewInboundTags.length ? (
										<Wrap spacing={1.5} mt={1}>
											{overviewInboundTags.map((tag) => (
												<WrapItem key={tag}>
													<Tag size="sm" colorScheme="teal" variant="subtle">
														{tag}
													</Tag>
												</WrapItem>
											))}
										</Wrap>
									) : (
										<Text fontSize="sm" color="gray.500" mt={1}>
											{t(
												"nodes.noInboundsConfigured",
												"No inbounds configured",
											)}
										</Text>
									)}
								</Box>
							</Stack>
						)}

						{!isAddMode && nodeCertificateValue && (
							<Stack className="xray-dialog-section" spacing={3}>
								<Stack
									direction={{ base: "column", sm: "row" }}
									justify="space-between"
									align={{ base: "stretch", sm: "center" }}
									spacing={2}
								>
									<Text fontWeight="medium" minW={0}>
										{t("nodes.certificate")}
									</Text>
									<HStack spacing={2} flexWrap="wrap" justify="flex-end">
										<Button
											size="xs"
											variant="outline"
											leftIcon={<CopyIconStyled />}
											onClick={handleCopyNodeCertificate}
										>
											{nodeCertificateCopied ? t("copied") : t("copy")}
										</Button>
										<Button
											size="xs"
											variant="outline"
											leftIcon={<DownloadIconStyled />}
											onClick={handleDownloadNodeCertificate}
										>
											{t("nodes.download-certificate")}
										</Button>
										<Tooltip
											placement="top"
											label={t(
												showCertificate
													? "nodes.hide-certificate"
													: "nodes.show-certificate",
											)}
										>
											<IconButton
												aria-label={t(
													showCertificate
														? "nodes.hide-certificate"
														: "nodes.show-certificate",
												)}
												onClick={() => setShowCertificate((prev) => !prev)}
												size="xs"
												variant="ghost"
											>
												{showCertificate ? (
													<EyeSlashIconStyled />
												) : (
													<EyeIconStyled />
												)}
											</IconButton>
										</Tooltip>
									</HStack>
								</Stack>
								<Collapse in={showCertificate} animateOpacity>
									<Box
										borderWidth="1px"
										borderRadius="md"
										p={3}
										fontFamily="mono"
										fontSize="xs"
										maxH="220px"
										overflow="auto"
										bg="gray.50"
										_dark={{ bg: "whiteAlpha.100" }}
									>
										{nodeCertificateValue}
									</Box>
								</Collapse>
							</Stack>
						)}

						<Stack
							className="xray-dialog-section node-form-section"
							spacing={3}
						>
							<Text fontSize="sm" fontWeight="semibold">
								{t("nodes.connectionSettings", "Connection settings")}
							</Text>
							{isAddMode && (
								<Checkbox isChecked isReadOnly isDisabled pointerEvents="none">
									{t(
										"nodes.certInfoOption",
										"Cert: After creating the node, the certificate will be shown. This option is informational only.",
									)}
								</Checkbox>
							)}
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<Input
									label={t("nodes.nodeName")}
									size="sm"
									placeholder="Rebecca-S2"
									maxLength={120}
									{...form.register("name")}
									error={getInputError(form.formState?.errors?.name)}
								/>
								<Input
									label={t("nodes.nodeAddress")}
									size="sm"
									placeholder="192.168.1.1 or 2001:db8::1"
									{...form.register("address")}
									error={getInputError(form.formState?.errors?.address)}
								/>
							</SimpleGrid>
							<FormControl isInvalid={Boolean(form.formState?.errors?.note)}>
								<FormLabel>{t("nodes.note", "Note")}</FormLabel>
								<Textarea
									size="sm"
									maxLength={500}
									rows={3}
									placeholder={t(
										"nodes.notePlaceholder",
										"Optional internal note for this node",
									)}
									{...form.register("note")}
								/>
								<FormErrorMessage>
									{getInputError(form.formState?.errors?.note)}
								</FormErrorMessage>
							</FormControl>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<Input
									label={t("nodes.nodePort")}
									size="sm"
									placeholder="62050"
									{...form.register("port")}
									error={getInputError(form.formState?.errors?.port)}
								/>
								<Input
									label={t("nodes.nodeAPIPort")}
									size="sm"
									placeholder="62051"
									{...form.register("api_port")}
									error={getInputError(form.formState?.errors?.api_port)}
								/>
							</SimpleGrid>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<Input
									label={t("nodes.usageCoefficient")}
									size="sm"
									placeholder="1"
									{...form.register("usage_coefficient")}
									error={getInputError(
										form.formState?.errors?.usage_coefficient,
									)}
								/>
								<FormControl>
									<Input
										label={t("nodes.dataLimitField", "Data Limit (GB)")}
										size="sm"
										type="number"
										step={0.01}
										min={0}
										placeholder={t(
											"nodes.dataLimitPlaceholder",
											"e.g., 500 (empty = unlimited)",
										)}
										{...form.register("data_limit", {
											setValueAs: (value) => {
												if (
													value === "" ||
													value === null ||
													value === undefined
												) {
													return null;
												}
												const parsed = Number(value);
												return Number.isFinite(parsed) ? parsed : Number.NaN;
											},
											validate: (value) => {
												if (value === null || value === undefined) {
													return true;
												}
												if (Number.isNaN(value)) {
													return t(
														"nodes.dataLimitValidation",
														"Data limit must be a valid number",
													);
												}
												return (
													value >= 0 ||
													t(
														"nodes.dataLimitPositive",
														"Data limit must be zero or greater",
													)
												);
											},
										})}
										error={getInputError(form.formState?.errors?.data_limit)}
									/>
									<Text fontSize="xs" color="gray.500" mt={1}>
										{t(
											"nodes.dataLimitHint",
											"Leave empty for unlimited data.",
										)}
									</Text>
								</FormControl>
							</SimpleGrid>
							{allowNobetci && (
								<>
									<FormControl className="node-switch-control">
										<FormLabel mb={0}>
											{t("nodes.useNobetci", "Enable Nobetci integration")}
										</FormLabel>
										<Controller
											control={form.control}
											name="use_nobetci"
											render={({ field }) => (
												<Switch
													isChecked={Boolean(field.value)}
													onChange={(event) =>
														field.onChange(event.target.checked)
													}
												/>
											)}
										/>
									</FormControl>
									<Collapse in={Boolean(useNobetci)} animateOpacity>
										<FormControl mt={useNobetci ? 2 : 0}>
											<Input
												label={t("nodes.nobetciPort", "Nobetci port")}
												size="sm"
												placeholder="443"
												{...form.register("nobetci_port", {
													setValueAs: (value) => {
														if (
															value === "" ||
															value === null ||
															value === undefined
														) {
															return null;
														}
														const parsed = Number(value);
														return Number.isFinite(parsed)
															? parsed
															: Number.NaN;
													},
													validate: (value) => {
														if (!useNobetci) {
															return true;
														}
														if (value === null || value === undefined) {
															return t(
																"nodes.nobetciPortRequired",
																"Port is required when Nobetci is enabled",
															);
														}
														if (Number.isNaN(value)) {
															return t(
																"nodes.nobetciPortInvalid",
																"Enter a valid port number",
															);
														}
														return value >= 1 && value <= 65535
															? true
															: t(
																	"nodes.nobetciPortRange",
																	"Port must be between 1 and 65535",
																);
													},
												})}
												error={getInputError(
													form.formState?.errors?.nobetci_port,
												)}
											/>
											<Text fontSize="xs" color="gray.500" mt={1}>
												{t(
													"nodes.nobetciHint",
													"Provide the Nobetci listener port. Leave blank to disable.",
												)}
											</Text>
										</FormControl>
									</Collapse>
								</>
							)}
							<FormControl className="node-switch-control">
								<FormLabel mb={0}>
									{t("nodes.useProxy", "Enable proxy for node connection")}
								</FormLabel>
								<Controller
									control={form.control}
									name="proxy_enabled"
									render={({ field }) => (
										<Switch
											isChecked={Boolean(field.value)}
											onChange={(event) => field.onChange(event.target.checked)}
										/>
									)}
								/>
							</FormControl>
							<Collapse in={Boolean(proxyEnabled)} animateOpacity>
								<Stack
									className="xray-dialog-section node-form-section"
									spacing={3}
									mt={2}
								>
									<Text fontSize="sm" fontWeight="semibold">
										{t("nodes.proxySettings", "Proxy settings")}
									</Text>
									<FormControl
										isInvalid={
											!!getInputError(form.formState?.errors?.proxy_type)
										}
									>
										<FormLabel>{t("nodes.proxyType", "Proxy type")}</FormLabel>
										<Select
											size="sm"
											placeholder={t(
												"nodes.proxyTypePlaceholder",
												"Select proxy type",
											)}
											{...form.register("proxy_type")}
										>
											<option value="http">HTTP</option>
											<option value="socks5">SOCKS5</option>
										</Select>
										<FormErrorMessage>
											{getInputError(form.formState?.errors?.proxy_type)}
										</FormErrorMessage>
									</FormControl>
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<Input
											label={t("nodes.proxyHost", "Proxy host")}
											size="sm"
											placeholder="proxy.example.com"
											{...form.register("proxy_host")}
											error={getInputError(form.formState?.errors?.proxy_host)}
										/>
										<Input
											label={t("nodes.proxyPort", "Proxy port")}
											size="sm"
											type="number"
											min={1}
											max={65535}
											placeholder="8080"
											{...form.register("proxy_port", {
												setValueAs: (value) => {
													if (
														value === "" ||
														value === null ||
														value === undefined
													) {
														return null;
													}
													const parsed = Number(value);
													return Number.isFinite(parsed) ? parsed : Number.NaN;
												},
											})}
											error={getInputError(form.formState?.errors?.proxy_port)}
										/>
									</SimpleGrid>
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<Input
											label={t("nodes.proxyUsername", "Proxy username")}
											size="sm"
											placeholder="user"
											{...form.register("proxy_username")}
											error={getInputError(
												form.formState?.errors?.proxy_username,
											)}
										/>
										<Input
											label={t("nodes.proxyPassword", "Proxy password")}
											size="sm"
											type="password"
											placeholder="••••••••"
											{...form.register("proxy_password")}
											error={getInputError(
												form.formState?.errors?.proxy_password,
											)}
										/>
									</SimpleGrid>
									<Text fontSize="xs" color="gray.500">
										{t(
											"nodes.proxyHint",
											"Applies only to master-to-node communication.",
										)}
									</Text>
								</Stack>
							</Collapse>
						</Stack>

					</Stack>
				</XrayModalBody>
				<XrayModalFooter justifyContent="flex-end">
					<Button variant="outline" onClick={handleClose}>
						{t("cancel")}
					</Button>
					<AnimatedSubmitButton
						status={submitStatus}
						idleContent={isAddMode ? t("nodes.addNode") : t("nodes.editNode")}
						successLabel={t("userDialog.submitSuccess", "Done")}
						isDisabled={isLoading}
						type="submit"
						containerProps={{ w: { base: "full", sm: "180px" } }}
					/>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
