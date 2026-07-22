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
import { PanelSelect as Select } from "components/common/PanelSelect";
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

	const buildMutationPayload = (data: NodeType) => ({
		...(isAddMode ? {} : { id: node?.id ?? data.id }),
		name: data.name,
		note: data.note ?? "",
		address: data.address,
		port: Number(data.port),
		api_port: Number(data.api_port),
		usage_coefficient: Number(data.usage_coefficient),
		data_limit: convertLimitToBytes(data.data_limit ?? null),
		proxy_enabled: Boolean(data.proxy_enabled),
		proxy_type: data.proxy_enabled ? data.proxy_type : null,
		proxy_host: data.proxy_enabled ? data.proxy_host : null,
		proxy_port:
			data.proxy_enabled && data.proxy_port !== null && data.proxy_port !== undefined
				? Number(data.proxy_port)
				: null,
		proxy_username: data.proxy_enabled ? data.proxy_username : null,
		proxy_password: data.proxy_enabled ? data.proxy_password : null,
	});

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
			: t("nodes.unlimited");
	const nodeRuntimeVersion =
		node?.node_binary_tag || node?.node_service_version || "";
	const nodeInstallLabel =
		[node?.node_install_mode, node?.node_update_channel]
			.filter(Boolean)
			.join(" / ") || "-";
	const certificateState = node?.uses_default_certificate
		? t("nodes.legacyCertificate")
		: node?.has_custom_certificate
			? t("nodes.privateCertificate")
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
		const payload = buildMutationPayload(data);
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
											{t("nodes.overview")}
										</Text>
										<Text
											fontSize="xs"
											color="gray.500"
											noOfLines={2}
											wordBreak="break-word"
										>
											{node.name || t("nodes.unnamedNode")} ·{" "}
											{t("admins.idLabel")}: {node.id ?? "-"}
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
										label={t("nodes.nodeAddress")}
										value={
											<Text as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
												{node.address || "-"}
											</Text>
										}
										detail={`${t("port")}: ${
											node.port ?? "-"
										} · ${t("nodes.nodeAPIPort")}: ${
											node.api_port ?? "-"
										}`}
									/>
									<OverviewItem
										label={t("nodes.trafficLimit")}
										value={`${formatNodeBytes(nodeUsageTotal)} / ${nodeLimitDisplay}`}
										detail={`${t("nodes.uplink")}: ${formatNodeBytes(
											node.uplink,
										)} · ${t("nodes.downlink")}: ${formatNodeBytes(
											node.downlink,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.range30d")}
										value={
											nodeUsagePeriodTotal !== null
												? formatNodeBytes(nodeUsagePeriodTotal)
												: "-"
										}
										detail={
											nodeUsage
												? `${t("nodes.uplink")}: ${formatNodeBytes(
														nodeUsage.uplink,
													)} · ${t("nodes.downlink")}: ${formatNodeBytes(
														nodeUsage.downlink,
													)}`
												: t("nodes.usageUnavailable")
										}
									/>
									<OverviewItem
										label={t("nodes.bandwidthSpeed")}
										value={`${formatNodeSpeed(node.upload_speed)} / ${formatNodeSpeed(
											node.download_speed,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.cpu")}
										value={formatNodePercent(node.cpu_usage_percent)}
										detail={`${node.cpu_cores ?? "-"} ${t("cores")} · ${formatCPUFrequency(node.cpu_frequency_hz)}`}
									/>
									<OverviewItem
										label={t("nodes.ram")}
										value={formatNodePercent(node.memory_usage_percent)}
										detail={`${formatNodeBytes(node.memory_used)} / ${formatNodeBytes(
											node.memory_total,
										)}`}
									/>
									<OverviewItem
										label={t("nodes.runtime")}
										value={
											node.xray_version
												? `Xray ${node.xray_version}`
												: t("nodes.versionUnknown")
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
										label={t("nodes.certificate")}
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
										{t("pages.xray.Inbounds")}
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
											{t("nodes.noInboundsConfigured")}
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
								{t("nodes.connectionSettings")}
							</Text>
							{isAddMode && (
								<Checkbox isChecked isReadOnly isDisabled pointerEvents="none">
									{t("nodes.certInfoOption")}
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
								<FormLabel>{t("fields.note")}</FormLabel>
								<Textarea
									size="sm"
									maxLength={500}
									rows={3}
									placeholder={t("nodes.notePlaceholder")}
									{...form.register("note")}
								/>
								<FormErrorMessage>
									{getInputError(form.formState?.errors?.note)}
								</FormErrorMessage>
							</FormControl>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<Input
									label={t("port")}
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
										label={t("nodes.dataLimitField")}
										size="sm"
										type="number"
										step={0.01}
										min={0}
										placeholder={t("nodes.dataLimitPlaceholder")}
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
													return t("nodes.dataLimitValidation");
												}
												return (
													value >= 0 ||
													t("nodes.dataLimitPositive")
												);
											},
										})}
										error={getInputError(form.formState?.errors?.data_limit)}
									/>
									<Text fontSize="xs" color="gray.500" mt={1}>
										{t("nodes.dataLimitHint")}
									</Text>
								</FormControl>
							</SimpleGrid>
							<FormControl className="node-switch-control rb-dialog-switch-row">
								<FormLabel mb={0}>
									{t("nodes.useProxy")}
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
										{t("nodes.proxySettings")}
									</Text>
									<FormControl
										isInvalid={
											!!getInputError(form.formState?.errors?.proxy_type)
										}
									>
										<FormLabel>{t("nodes.proxyType")}</FormLabel>
									<Controller
										control={form.control}
										name="proxy_type"
										render={({ field }) => (
											<Select
												size="sm"
												placeholder={t("nodes.proxyTypePlaceholder")}
												name={field.name}
												value={field.value ?? ""}
												onBlur={field.onBlur}
												onValueChange={(value) => field.onChange(value || null)}
												options={[
													{ value: "http", label: "HTTP" },
													{ value: "socks5", label: "SOCKS5" },
												]}
											/>
										)}
									/>
										<FormErrorMessage>
											{getInputError(form.formState?.errors?.proxy_type)}
										</FormErrorMessage>
									</FormControl>
									<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
										<Input
											label={t("nodes.proxyHost")}
											size="sm"
											placeholder="proxy.example.com"
											{...form.register("proxy_host")}
											error={getInputError(form.formState?.errors?.proxy_host)}
										/>
										<Input
											label={t("nodes.proxyPort")}
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
											label={t("nodes.proxyUsername")}
											size="sm"
											placeholder="user"
											{...form.register("proxy_username")}
											error={getInputError(
												form.formState?.errors?.proxy_username,
											)}
										/>
										<Input
											label={t("nodes.proxyPassword")}
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
										{t("nodes.proxyHint")}
									</Text>
								</Stack>
							</Collapse>
						</Stack>

					</Stack>
				</XrayModalBody>
				<XrayModalFooter justifyContent="flex-end">
					<Button variant="outline" size="sm" onClick={handleClose}>
						{t("cancel")}
					</Button>
					<AnimatedSubmitButton
						status={submitStatus}
						idleContent={isAddMode ? t("nodes.addNode") : t("nodes.editNode")}
						successLabel={t("userDialog.submitSuccess")}
						isDisabled={isLoading}
						type="submit"
						containerProps={{ w: { base: "full", sm: "180px" } }}
					/>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
