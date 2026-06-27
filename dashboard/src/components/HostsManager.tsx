import {
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	CardHeader,
	Checkbox,
	chakra,
	FormControl,
	FormLabel,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputRightElement,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverCloseButton,
	PopoverContent,
	PopoverTrigger,
	Portal,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Tag,
	Text,
	Textarea,
	Tooltip,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	InformationCircleIcon,
	ListBulletIcon,
	PencilIcon,
	PlusIcon,
	Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
	proxyALPN,
	proxyFingerprint,
	proxyHostSecurity,
} from "constants/Proxies";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type HostsSchema, useHosts } from "contexts/HostsContext";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { NumericInput } from "./common/NumericInput";
import { DeleteConfirmPopover } from "./DeleteConfirmPopover";
import { DeleteIcon } from "./DeleteUserModal";
import { JsonEditor } from "./JsonEditor";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type HostData = {
	id: number | null;
	remark: string;
	address: string;
	address_options: string;
	address_selection_mode: string;
	address_ttl_seconds: number | null;
	port: number | null;
	path: string;
	sni: string;
	sni_options: string;
	sni_selection_mode: string;
	sni_ttl_seconds: number | null;
	host: string;
	host_options: string;
	host_selection_mode: string;
	host_ttl_seconds: number | null;
	mux_enable: boolean;
	allowinsecure: boolean;
	is_disabled: boolean;
	fragment_setting: string;
	noise_setting: string;
	random_user_agent: boolean;
	security: string;
	alpn: string;
	fingerprint: string;
	use_sni_as_host: boolean;
};

const coerceHostValue = <Key extends keyof HostData>(
	key: Key,
	value: unknown,
	currentData: HostData,
): HostData[Key] => {
	if (
		key === "port" ||
		key === "address_ttl_seconds" ||
		key === "sni_ttl_seconds" ||
		key === "host_ttl_seconds"
	) {
		if (value === null || value === "") {
			return null as HostData[Key];
		}
		const numeric = Number(value);
		return Number.isFinite(numeric)
			? (numeric as HostData[Key])
			: (currentData[key] as HostData[Key]);
	}
	if (key === "id") {
		if (value === null || value === "") {
			return null as HostData[Key];
		}
		const numeric = Number(value);
		return Number.isFinite(numeric)
			? (numeric as HostData[Key])
			: (currentData.id as HostData[Key]);
	}
	if (
		key === "mux_enable" ||
		key === "allowinsecure" ||
		key === "is_disabled" ||
		key === "random_user_agent" ||
		key === "use_sni_as_host"
	) {
		return Boolean(value) as HostData[Key];
	}
	if (
		key === "address_options" ||
		key === "sni_options" ||
		key === "host_options"
	) {
		if (Array.isArray(value)) {
			return rotationOptionsToText(
				value.filter((item): item is string => typeof item === "string"),
			) as HostData[Key];
		}
		return String(value ?? "") as HostData[Key];
	}
	if (
		key === "address_selection_mode" ||
		key === "sni_selection_mode" ||
		key === "host_selection_mode"
	) {
		return normalizeRotationMode(String(value ?? "")) as HostData[Key];
	}
	return (value ?? "") as HostData[Key];
};

const EMPTY_HOST_DATA: HostData = {
	id: null,
	remark: "",
	address: "",
	address_options: "",
	address_selection_mode: "random",
	address_ttl_seconds: null,
	port: null,
	path: "",
	sni: "",
	sni_options: "",
	sni_selection_mode: "random",
	sni_ttl_seconds: null,
	host: "",
	host_options: "",
	host_selection_mode: "random",
	host_ttl_seconds: null,
	mux_enable: false,
	allowinsecure: false,
	is_disabled: false,
	fragment_setting: "",
	noise_setting: "",
	random_user_agent: false,
	security: "inbound_default",
	alpn: "",
	fingerprint: "",
	use_sni_as_host: false,
};

type HostState = {
	uid: string;
	inboundTag: string;
	initialInboundTag: string;
	data: HostData;
	original: HostData;
};

type InboundOption = {
	label: string;
	value: string;
	protocol: string;
	network: string;
};

type CreateHostValues = {
	inboundTag: string;
	remark: string;
	address: string;
	address_options: string;
	address_selection_mode: string;
	address_ttl_seconds: number | null;
	port: number | null;
	path: string;
	sni: string;
	sni_options: string;
	sni_selection_mode: string;
	sni_ttl_seconds: number | null;
	host: string;
	host_options: string;
	host_selection_mode: string;
	host_ttl_seconds: number | null;
};

const EditIcon = chakra(PencilIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const AddIcon = chakra(PlusIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const GridViewIcon = chakra(Squares2X2Icon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const ListViewIcon = chakra(ListBulletIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const InfoIcon = chakra(InformationCircleIcon, {
	baseStyle: {
		w: 4,
		h: 4,
		color: "gray.400",
		cursor: "pointer",
	},
});

const DYNAMIC_TOKENS: Array<{ token: string; labelKey: string }> = [
	{ token: "{SERVER_IP}", labelKey: "hostsDialog.currentServer" },
	{ token: "{SERVER_IPV6}", labelKey: "hostsDialog.currentServerv6" },
	{ token: "{USERNAME}", labelKey: "hostsDialog.username" },
	{ token: "{DATA_USAGE}", labelKey: "hostsDialog.dataUsage" },
	{ token: "{DATA_LEFT}", labelKey: "hostsDialog.remainingData" },
	{ token: "{DATA_LIMIT}", labelKey: "hostsDialog.dataLimit" },
	{ token: "{DAYS_LEFT}", labelKey: "hostsDialog.remainingDays" },
	{ token: "{EXPIRE_DATE}", labelKey: "hostsDialog.expireDate" },
	{ token: "{JALALI_EXPIRE_DATE}", labelKey: "hostsDialog.jalaliExpireDate" },
	{ token: "{TIME_LEFT}", labelKey: "hostsDialog.remainingTime" },
	{ token: "{STATUS_TEXT}", labelKey: "hostsDialog.statusText" },
	{ token: "{STATUS_EMOJI}", labelKey: "hostsDialog.statusEmoji" },
	{ token: "{PROTOCOL}", labelKey: "hostsDialog.proxyProtocol" },
	{ token: "{TRANSPORT}", labelKey: "hostsDialog.proxyMethod" },
];

type RotationFieldsProps = {
	label: string;
	value: string;
	mode: string;
	ttl: number | null;
	onValueChange: (value: string) => void;
	onModeChange: (value: string) => void;
	onTTLChange: (value: number | null) => void;
};

const RotationFields: FC<RotationFieldsProps> = ({
	label,
	value,
	mode,
	ttl,
	onValueChange,
	onModeChange,
	onTTLChange,
}) => {
	const { t } = useTranslation();
	return (
		<FormControl>
			<FormLabel>{label}</FormLabel>
			<Textarea
				value={value}
				rows={3}
				resize="vertical"
				placeholder={t(
					"hostsDialog.rotationPlaceholder",
					"One value per line. Leave empty to use the single field above.",
				)}
				onChange={(event) => onValueChange(event.target.value)}
			/>
			<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mt={3}>
				<FormControl>
					<FormLabel fontSize="sm">
						{t("hostsDialog.rotationMode", "Selection mode")}
					</FormLabel>
					<Select value={mode} onChange={(event) => onModeChange(event.target.value)}>
						<option value="random">{t("hostsDialog.rotationRandom", "Random")}</option>
						<option value="ttl">{t("hostsDialog.rotationTTL", "TTL")}</option>
					</Select>
				</FormControl>
				<FormControl>
					<FormLabel fontSize="sm">
						{t("hostsDialog.rotationTTLSeconds", "TTL seconds")}
					</FormLabel>
					<NumericInput
						value={ttl ?? ""}
						min={1}
						max={2592000}
						isDisabled={mode !== "ttl"}
						onChange={(_, num) => onTTLChange(Number.isNaN(num) ? null : num)}
					/>
				</FormControl>
			</SimpleGrid>
		</FormControl>
	);
};

const HOST_MODAL_SX = {
	".xray-dialog-section .chakra-form-control": {
		display: "block",
	},
	".xray-dialog-section .chakra-form__label": {
		whiteSpace: "nowrap",
		mb: 1.5,
	},
};

const DynamicTokensPopover: FC = () => {
	const { t } = useTranslation();

	return (
		<Popover isLazy placement="right">
			<PopoverTrigger>
				<Box mt="-1">
					<InfoIcon />
				</Box>
			</PopoverTrigger>
			<Portal>
				<PopoverContent maxW="xs" fontSize="xs">
					<PopoverArrow />
					<PopoverCloseButton />
					<PopoverBody>
						<Box pr={5} lineHeight="1.4">
							<Text mb={2}>{t("hostsDialog.desc")}</Text>
							{DYNAMIC_TOKENS.map(({ token, labelKey }) => (
								<Text key={token} mt={1}>
									<Badge mr={2}>{token}</Badge>
									{t(labelKey)}
								</Text>
							))}
						</Box>
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);
};

const createUid = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeString = (value: string | null | undefined) =>
	(value ?? "").trim();

const normalizeRotationMode = (value: string | null | undefined) =>
	value === "ttl" ? "ttl" : "random";

const rotationOptionsToText = (values: string[] | null | undefined) =>
	(values ?? []).map((value) => value.trim()).filter(Boolean).join("\n");

const rotationTextToOptions = (value: string) =>
	value
		.split(/\r?\n|,/)
		.map((item) => item.trim())
		.filter(Boolean);

const normalizeBoolean = (
	value: boolean | null | undefined,
	fallback = false,
) => (typeof value === "boolean" ? value : fallback);

const normalizeHostData = (host: HostsSchema[string][number]): HostData => ({
	id: host.id ?? null,
	remark: host.remark ?? "",
	address: host.address ?? "",
	address_options: rotationOptionsToText(host.address_options),
	address_selection_mode: normalizeRotationMode(host.address_selection_mode),
	address_ttl_seconds: host.address_ttl_seconds ?? null,
	port: host.port ?? null,
	path: normalizeString(host.path),
	sni: normalizeString(host.sni),
	sni_options: rotationOptionsToText(host.sni_options),
	sni_selection_mode: normalizeRotationMode(host.sni_selection_mode),
	sni_ttl_seconds: host.sni_ttl_seconds ?? null,
	host: normalizeString(host.host),
	host_options: rotationOptionsToText(host.host_options),
	host_selection_mode: normalizeRotationMode(host.host_selection_mode),
	host_ttl_seconds: host.host_ttl_seconds ?? null,
	mux_enable: normalizeBoolean(host.mux_enable),
	allowinsecure: normalizeBoolean(host.allowinsecure),
	is_disabled: normalizeBoolean(host.is_disabled, false),
	fragment_setting: normalizeString(host.fragment_setting),
	noise_setting: normalizeString(host.noise_setting),
	random_user_agent: normalizeBoolean(host.random_user_agent),
	security: host.security ?? "inbound_default",
	alpn: host.alpn ?? "",
	fingerprint: host.fingerprint ?? "",
	use_sni_as_host: normalizeBoolean(host.use_sni_as_host),
});

const cloneHostData = (data: HostData): HostData => ({
	id: data.id ?? null,
	remark: data.remark,
	address: data.address,
	address_options: data.address_options,
	address_selection_mode: data.address_selection_mode,
	address_ttl_seconds: data.address_ttl_seconds ?? null,
	port: data.port ?? null,
	path: data.path,
	sni: data.sni,
	sni_options: data.sni_options,
	sni_selection_mode: data.sni_selection_mode,
	sni_ttl_seconds: data.sni_ttl_seconds ?? null,
	host: data.host,
	host_options: data.host_options,
	host_selection_mode: data.host_selection_mode,
	host_ttl_seconds: data.host_ttl_seconds ?? null,
	mux_enable: data.mux_enable,
	allowinsecure: data.allowinsecure,
	is_disabled: data.is_disabled,
	fragment_setting: data.fragment_setting,
	noise_setting: data.noise_setting,
	random_user_agent: data.random_user_agent,
	security: data.security,
	alpn: data.alpn,
	fingerprint: data.fingerprint,
	use_sni_as_host: data.use_sni_as_host,
});

const serializeHostData = (data: HostData) => ({
	...data,
	id: data.id ?? null,
	port: data.port ?? null,
	path: normalizeString(data.path),
	sni: normalizeString(data.sni),
	host: normalizeString(data.host),
	address_options: rotationTextToOptions(data.address_options),
	address_selection_mode: normalizeRotationMode(data.address_selection_mode),
	address_ttl_seconds: data.address_ttl_seconds ?? null,
	sni_options: rotationTextToOptions(data.sni_options),
	sni_selection_mode: normalizeRotationMode(data.sni_selection_mode),
	sni_ttl_seconds: data.sni_ttl_seconds ?? null,
	host_options: rotationTextToOptions(data.host_options),
	host_selection_mode: normalizeRotationMode(data.host_selection_mode),
	host_ttl_seconds: data.host_ttl_seconds ?? null,
	fragment_setting: normalizeString(data.fragment_setting),
	noise_setting: normalizeString(data.noise_setting),
});

const validateHostState = (
	inboundTag: string,
	data: HostData | CreateHostValues,
): string[] => {
	const errors: string[] = [];
	if (!inboundTag.trim()) {
		errors.push("Inbound is required.");
	}
	if (!data.remark.trim()) {
		errors.push("Remark is required.");
	}
	if (!data.address.trim() && rotationTextToOptions(data.address_options).length === 0) {
		errors.push("Address is required.");
	}
	if (data.port !== null) {
		const port = Number(data.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			errors.push("Port must be a number between 1 and 65535.");
		}
	}
	const path = data.path.trim();
	if (path && !path.startsWith("/")) {
		errors.push("Path must start with /.");
	}
	for (const [label, mode, ttl] of [
		["Address", data.address_selection_mode, data.address_ttl_seconds],
		["SNI", data.sni_selection_mode, data.sni_ttl_seconds],
		["Request Host", data.host_selection_mode, data.host_ttl_seconds],
	] as const) {
		if (mode === "ttl" && ttl !== null) {
			const numeric = Number(ttl);
			if (!Number.isInteger(numeric) || numeric < 1 || numeric > 2592000) {
				errors.push(`${label} TTL must be between 1 and 2592000 seconds.`);
			}
		}
	}
	return errors;
};

const isHostDirty = (host: HostState) => {
	const current = serializeHostData(host.data);
	const original = serializeHostData(host.original);
	if (host.inboundTag !== host.initialInboundTag) {
		return true;
	}
	return JSON.stringify(current) !== JSON.stringify(original);
};

const formatHostForApi = (data: HostData): HostsSchema[string][number] => {
	const addressOptions = rotationTextToOptions(data.address_options);
	return {
		id: data.id ?? null,
		remark: data.remark.trim(),
		address: data.address.trim() || addressOptions[0] || "",
		address_options: addressOptions,
		address_selection_mode: normalizeRotationMode(data.address_selection_mode),
		address_ttl_seconds: data.address_ttl_seconds ?? null,
		port: data.port,
		path: data.path.trim() ? data.path.trim() : null,
		sni: data.sni.trim() ? data.sni.trim() : null,
		sni_options: rotationTextToOptions(data.sni_options),
		sni_selection_mode: normalizeRotationMode(data.sni_selection_mode),
		sni_ttl_seconds: data.sni_ttl_seconds ?? null,
		host: data.host.trim() ? data.host.trim() : null,
		host_options: rotationTextToOptions(data.host_options),
		host_selection_mode: normalizeRotationMode(data.host_selection_mode),
		host_ttl_seconds: data.host_ttl_seconds ?? null,
		mux_enable: data.mux_enable,
		allowinsecure: data.allowinsecure,
		is_disabled: data.is_disabled,
		fragment_setting: data.fragment_setting.trim()
			? data.fragment_setting.trim()
			: null,
		noise_setting: data.noise_setting.trim() ? data.noise_setting.trim() : null,
		random_user_agent: data.random_user_agent,
		security: data.security || "inbound_default",
		alpn: data.alpn || "",
		fingerprint: data.fingerprint || "",
		use_sni_as_host: data.use_sni_as_host,
	};
};

const sortHosts = (hosts: HostState[]) =>
	[...hosts].sort((a, b) => {
		const inboundDiff = a.inboundTag.localeCompare(b.inboundTag);
		if (inboundDiff !== 0) return inboundDiff;
		const leftID = a.data.id ?? Number.MAX_SAFE_INTEGER;
		const rightID = b.data.id ?? Number.MAX_SAFE_INTEGER;
		if (leftID !== rightID) return leftID - rightID;
		return a.data.remark.localeCompare(b.data.remark);
	});

const mapHostsToState = (hosts: HostsSchema): HostState[] => {
	const result: HostState[] = [];
	if (!hosts || typeof hosts !== "object") {
		return result;
	}
	Object.entries(hosts).forEach(([tag, hostList]) => {
		if (!Array.isArray(hostList)) {
			console.warn(`Host list for tag ${tag} is not an array:`, hostList);
			return;
		}
		hostList.forEach((host, index) => {
			try {
				const normalized = normalizeHostData(host);
				const persistentUid =
					normalized.id != null ? `host-${normalized.id}` : createUid();
				result.push({
					uid: persistentUid,
					inboundTag: tag,
					initialInboundTag: tag,
					data: cloneHostData(normalized),
					original: cloneHostData(normalized),
				});
			} catch (error) {
				console.error(
					`Failed to normalize host at index ${index} for tag ${tag}:`,
					error,
					host,
				);
			}
		});
	});
	return sortHosts(result);
};

const groupHostsByInbound = (items: HostState[]): HostsSchema => {
	const grouped = new Map<string, HostData[]>();
	items.forEach((host) => {
		const list = grouped.get(host.inboundTag) ?? [];
		list.push(host.data);
		grouped.set(host.inboundTag, list);
	});
	const result: HostsSchema = {};
	grouped.forEach((value, key) => {
		result[key] = value.map((host) => formatHostForApi(host));
	});
	return result;
};

const buildInboundPayload = (
	items: HostState[],
	inboundTags: Iterable<string>,
): Partial<HostsSchema> => {
	const grouped = groupHostsByInbound(items);
	const uniqueTags = Array.from(new Set(inboundTags));
	const payload: Partial<HostsSchema> = {};
	uniqueTags.forEach((tag) => {
		payload[tag] = grouped[tag] ?? [];
	});
	return payload;
};

type HostCardProps = {
	host: HostState;
	inboundOptions: InboundOption[];
	onToggleActive: (uid: string, active: boolean) => void;
	onEdit: (uid: string) => void;
	onDelete: (uid: string) => void;
	saving: boolean;
	deleting: boolean;
};

const HostCard: FC<HostCardProps> = ({
	host,
	inboundOptions,
	onToggleActive,
	onEdit,
	onDelete,
	saving,
	deleting,
}) => {
	const { t } = useTranslation();
	const inbound = inboundOptions.find(
		(option) => option.value === host.inboundTag,
	);
	const active = !host.data.is_disabled;
	const dirty = isHostDirty(host);
	const hostName = host.data.remark || t("hostsPage.untitledHost");

	return (
		<Card
			borderWidth="1px"
			borderColor={dirty ? "primary.400" : "gray.200"}
			_dark={{
				borderColor: dirty ? "primary.300" : "gray.700",
				bg: dirty ? "gray.800" : "gray.900",
			}}
			cursor="pointer"
			onClick={() => onEdit(host.uid)}
			transition="border-color 0.2s ease"
			_hover={{ borderColor: "primary.400" }}
		>
			<CardBody as={Stack} spacing={4}>
				<HStack justify="space-between" align="center" wrap="wrap" rowGap={2}>
					<VStack align="flex-start" spacing={1} flex="1">
						<Tooltip label={host.data.remark} isDisabled={!host.data.remark}>
							<Text fontWeight="semibold" noOfLines={1} maxW="full">
								{hostName}
							</Text>
						</Tooltip>
						<HStack spacing={2} flexWrap="wrap">
							{inbound && (
								<Tag colorScheme="purple" size="sm">
									{`${inbound.value} (${inbound.protocol.toUpperCase()} - ${inbound.network})`}
								</Tag>
							)}
							{typeof host.data.port === "number" && (
								<Tag colorScheme="blue" size="sm">
									{t("hostsPage.portTag", { value: host.data.port })}
								</Tag>
							)}
							{dirty && (
								<Tag colorScheme="orange" size="sm">
									{t("hostsPage.unsaved")}
								</Tag>
							)}
						</HStack>
					</VStack>
					<HStack
						spacing={2}
						onClick={(event) => event.stopPropagation()}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<Switch
							size="sm"
							colorScheme="primary"
							isChecked={active}
							onChange={(event) => {
								event.stopPropagation();
								onToggleActive(host.uid, event.target.checked);
							}}
							onClick={(event) => event.stopPropagation()}
							onPointerDown={(event) => event.stopPropagation()}
							aria-label={t("hostsPage.toggleActive")}
						/>
						<Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
							{active ? t("hostsPage.enabled") : t("hostsPage.disabled")}
						</Text>
					</HStack>
				</HStack>

				<VStack
					align="stretch"
					spacing={2}
					color="gray.600"
					_dark={{ color: "gray.300" }}
				>
					<Text fontSize="sm">
						{host.data.address || t("hostsPage.noAddress")}
					</Text>
					{host.data.path && (
						<Text fontSize="sm" noOfLines={1}>
							{t("hostsDialog.path")}: {host.data.path}
						</Text>
					)}
					{host.data.sni && (
						<Text fontSize="sm" noOfLines={1}>
							{t("hostsDialog.sni")}: {host.data.sni}
						</Text>
					)}
				</VStack>

				<HStack justify="space-between">
					<Button
						size="sm"
						variant="outline"
						leftIcon={<EditIcon />}
						onClick={(event) => {
							event.stopPropagation();
							onEdit(host.uid);
						}}
						isLoading={saving}
					>
						{t("hostsPage.edit")}
					</Button>
					<DeleteConfirmPopover
						message={t("hostsPage.deleteConfirmation")}
						isLoading={deleting}
						onConfirm={() => onDelete(host.uid)}
					>
						<IconButton
							aria-label={t("hostsPage.delete")}
							size="sm"
							colorScheme="red"
							variant="ghost"
							onClick={(event) => event.stopPropagation()}
							icon={<DeleteIcon />}
						/>
					</DeleteConfirmPopover>
				</HStack>
			</CardBody>
		</Card>
	);
};

const HostListRow: FC<HostCardProps> = ({
	host,
	inboundOptions,
	onToggleActive,
	onEdit,
	onDelete,
	saving,
	deleting,
}) => {
	const { t } = useTranslation();
	const inbound = inboundOptions.find(
		(option) => option.value === host.inboundTag,
	);
	const active = !host.data.is_disabled;
	const dirty = isHostDirty(host);
	const hostName = host.data.remark || t("hostsPage.untitledHost");

	return (
		<Box
			borderWidth="1px"
			borderRadius="md"
			borderColor={dirty ? "primary.400" : "gray.200"}
			_dark={{
				borderColor: dirty ? "primary.300" : "gray.700",
				bg: dirty ? "gray.800" : "gray.900",
			}}
			px={{ base: 4, md: 5 }}
			py={3}
			onClick={() => onEdit(host.uid)}
			cursor="pointer"
			transition="border-color 0.2s ease"
			_hover={{ borderColor: "primary.400" }}
		>
			<HStack justify="space-between" align="center" spacing={4}>
				<VStack align="flex-start" spacing={1} flex="1">
					<HStack spacing={2} flexWrap="wrap">
						<Text fontWeight="semibold" noOfLines={1}>
							{hostName}
						</Text>
						{inbound && (
							<Tag colorScheme="purple" size="sm">
								{`${inbound.value} (${inbound.protocol.toUpperCase()} - ${inbound.network})`}
							</Tag>
						)}
						{typeof host.data.port === "number" && (
							<Tag colorScheme="blue" size="sm">
								{t("hostsPage.portTag", { value: host.data.port })}
							</Tag>
						)}
						{dirty && (
							<Tag colorScheme="orange" size="sm">
								{t("hostsPage.unsaved")}
							</Tag>
						)}
					</HStack>
					<Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
						{host.data.address || t("hostsPage.noAddress")}
					</Text>
				</VStack>
				<HStack
					spacing={3}
					onClick={(event) => event.stopPropagation()}
					onPointerDown={(event) => event.stopPropagation()}
				>
					<Switch
						size="sm"
						colorScheme="primary"
						isChecked={active}
						onChange={(event) => {
							event.stopPropagation();
							onToggleActive(host.uid, event.target.checked);
						}}
						onClick={(event) => event.stopPropagation()}
						onPointerDown={(event) => event.stopPropagation()}
						aria-label={t("hostsPage.toggleActive")}
					/>
					<Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
						{active ? t("hostsPage.enabled") : t("hostsPage.disabled")}
					</Text>
					<IconButton
						aria-label={t("hostsPage.edit")}
						size="sm"
						variant="ghost"
						icon={<EditIcon />}
						onClick={(event) => {
							event.stopPropagation();
							onEdit(host.uid);
						}}
						isLoading={saving}
					/>
					<DeleteConfirmPopover
						message={t("hostsPage.deleteConfirmation")}
						isLoading={deleting}
						onConfirm={() => onDelete(host.uid)}
					>
						<IconButton
							aria-label={t("hostsPage.delete")}
							size="sm"
							colorScheme="red"
							variant="ghost"
							onClick={(event) => event.stopPropagation()}
							icon={<DeleteIcon />}
						/>
					</DeleteConfirmPopover>
				</HStack>
			</HStack>
		</Box>
	);
};

type HostDetailModalProps = {
	host: HostState | null;
	inboundOptions: InboundOption[];
	isOpen: boolean;
	onClose: () => void;
	onChange: <Key extends keyof HostData>(
		uid: string,
		key: Key,
		value: HostData[Key],
	) => void;
	onChangeInbound: (uid: string, inboundTag: string) => void;
	onSave: (uid: string) => void;
	onReset: (uid: string) => void;
	onDelete: (uid: string) => void;
	saving: boolean;
	deleting: boolean;
	mode?: "edit" | "clone";
	onClone?: (uid: string) => void;
};

const HostDetailModal: FC<HostDetailModalProps> = ({
	host,
	inboundOptions,
	isOpen,
	onClose,
	onChange,
	onChangeInbound,
	onSave,
	onReset,
	onDelete,
	saving,
	deleting,
	mode = "edit",
	onClone,
}) => {
	const { t } = useTranslation();
	const [jsonText, setJsonText] = useState<string>("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const updatingFromJsonRef = useRef(false);
	const _resolvedHost = host ?? {
		uid: "",
		inboundTag: "",
		initialInboundTag: "",
		data: EMPTY_HOST_DATA,
		original: EMPTY_HOST_DATA,
	};
	const isCloneMode = mode === "clone";
	const dirty = host ? isHostDirty(host) : false;
	const canSubmit = host
		? Boolean(
				host.inboundTag &&
					host.data.remark.trim() &&
					(host.data.address.trim() ||
						rotationTextToOptions(host.data.address_options).length > 0),
			)
		: false;
	const primaryDisabled = isCloneMode ? !canSubmit : !dirty;
	const primaryLabel = isCloneMode
		? t("hostsPage.clone.submit")
		: t("hostsPage.save");
	const hostPayload = useMemo(() => {
		if (!host) {
			return null;
		}
		return {
			inboundTag: host.inboundTag,
			...formatHostForApi(host.data),
		};
	}, [host]);
	useEffect(() => {
		if (!hostPayload) {
			setJsonText("");
			setJsonError(null);
			return;
		}
		if (updatingFromJsonRef.current) {
			updatingFromJsonRef.current = false;
			return;
		}
		const formatted = JSON.stringify(hostPayload, null, 2);
		setJsonText((prev) => (prev === formatted ? prev : formatted));
		setJsonError(null);
	}, [hostPayload]);

	const handleJsonEditorChange = useCallback(
		(value: string) => {
			if (!host) {
				return;
			}
			setJsonText(value);
			try {
				const parsed = JSON.parse(value);
				if (!parsed || typeof parsed !== "object") {
					throw new Error("Invalid JSON payload");
				}
				const payload = parsed as Record<string, unknown>;
				const nextInboundTag =
					typeof payload.inboundTag === "string"
						? payload.inboundTag
						: host.inboundTag;

				updatingFromJsonRef.current = true;
				if (nextInboundTag !== host.inboundTag) {
					onChangeInbound(host.uid, nextInboundTag);
				}

				(Object.keys(host.data) as Array<keyof HostData>).forEach((key) => {
					if (Object.hasOwn(payload, key)) {
						onChange(
							host.uid,
							key,
							coerceHostValue(key, payload[key], host.data),
						);
					}
				});

				setJsonError(null);
			} catch (error) {
				setJsonError(error instanceof Error ? error.message : "Invalid JSON");
			}
		},
		[host, onChange, onChangeInbound],
	);

	if (!host) {
		return null;
	}

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="4xl"
			scrollBehavior="inside"
			isCentered
			returnFocusOnClose={false}
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3" sx={HOST_MODAL_SX}>
				<ModalCloseButton />
				<XrayModalHeader
					subtitle={isCloneMode ? t("hostsPage.clone.description") : undefined}
				>
					{isCloneMode
						? t("hostsPage.clone.title")
						: host.data.remark || t("hostsPage.untitledHost")}
				</XrayModalHeader>
				<XrayModalBody>
					<Tabs className="xray-dialog-auto-sections" variant="unstyled">
						<TabList>
							<Tab>{t("form")}</Tab>
							<Tab>{t("json")}</Tab>
						</TabList>
						<TabPanels>
							<TabPanel px={0}>
								<VStack align="stretch" spacing={5}>
									<Card className="xray-dialog-section" variant="outline">
										<CardHeader pb={2}>
											<Text fontWeight="semibold">
												{t("hostsPage.section.general")}
											</Text>
										</CardHeader>
										<CardBody pt={0}>
											<VStack align="stretch" spacing={4}>
												<FormControl>
													<FormLabel>{t("hostsDialog.remark")}</FormLabel>
													<InputGroup>
														<Input
															value={host.data.remark}
															onChange={(event) =>
																onChange(host.uid, "remark", event.target.value)
															}
														/>
														<InputRightElement
															width="auto"
															pr={2}
															pointerEvents="auto"
														>
															<DynamicTokensPopover />
														</InputRightElement>
													</InputGroup>
												</FormControl>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
														<Select
															value={host.inboundTag}
															onChange={(event) =>
																onChangeInbound(host.uid, event.target.value)
															}
														>
															{inboundOptions.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</Select>
													</FormControl>
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>{t("hostsDialog.address")}</FormLabel>
														<InputGroup>
															<Input
																value={host.data.address}
																onChange={(event) =>
																	onChange(
																		host.uid,
																		"address",
																		event.target.value,
																	)
																}
															/>
															<InputRightElement
																width="auto"
																pr={2}
																pointerEvents="auto"
															>
																<DynamicTokensPopover />
															</InputRightElement>
														</InputGroup>
													</FormControl>
													<FormControl>
														<FormLabel>{t("hostsDialog.port")}</FormLabel>
														<NumericInput
															value={host.data.port ?? ""}
															allowMouseWheel
															onChange={(_, num) =>
																onChange(
																	host.uid,
																	"port",
																	Number.isNaN(num) ? null : num,
																)
															}
														/>
													</FormControl>
												</SimpleGrid>
												<RotationFields
													label={t(
														"hostsDialog.addressRotation",
														"Address rotation values",
													)}
													value={host.data.address_options}
													mode={host.data.address_selection_mode}
													ttl={host.data.address_ttl_seconds}
													onValueChange={(value) =>
														onChange(host.uid, "address_options", value)
													}
													onModeChange={(value) =>
														onChange(host.uid, "address_selection_mode", value)
													}
													onTTLChange={(value) =>
														onChange(host.uid, "address_ttl_seconds", value)
													}
												/>
												<FormControl>
													<FormLabel>{t("hostsDialog.path")}</FormLabel>
													<Input
														value={host.data.path}
														onChange={(event) =>
															onChange(host.uid, "path", event.target.value)
														}
														placeholder="/"
													/>
												</FormControl>
											</VStack>
										</CardBody>
									</Card>

									<Card className="xray-dialog-section" variant="outline">
										<CardHeader pb={2}>
											<Text fontWeight="semibold">
												{t("hostsPage.section.security")}
											</Text>
										</CardHeader>
										<CardBody pt={0}>
											<VStack align="stretch" spacing={4}>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>{t("hostsDialog.sni")}</FormLabel>
														<Input
															value={host.data.sni}
															onChange={(event) =>
																onChange(host.uid, "sni", event.target.value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>{t("hostsDialog.host")}</FormLabel>
														<InputGroup>
															<Input
																value={host.data.host}
																onChange={(event) =>
																	onChange(host.uid, "host", event.target.value)
																}
															/>
															<InputRightElement
																width="auto"
																pr={2}
																pointerEvents="auto"
															>
																<DynamicTokensPopover />
															</InputRightElement>
														</InputGroup>
													</FormControl>
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<RotationFields
														label={t(
															"hostsDialog.sniRotation",
															"SNI rotation values",
														)}
														value={host.data.sni_options}
														mode={host.data.sni_selection_mode}
														ttl={host.data.sni_ttl_seconds}
														onValueChange={(value) =>
															onChange(host.uid, "sni_options", value)
														}
														onModeChange={(value) =>
															onChange(host.uid, "sni_selection_mode", value)
														}
														onTTLChange={(value) =>
															onChange(host.uid, "sni_ttl_seconds", value)
														}
													/>
													<RotationFields
														label={t(
															"hostsDialog.hostRotation",
															"Request Host rotation values",
														)}
														value={host.data.host_options}
														mode={host.data.host_selection_mode}
														ttl={host.data.host_ttl_seconds}
														onValueChange={(value) =>
															onChange(host.uid, "host_options", value)
														}
														onModeChange={(value) =>
															onChange(host.uid, "host_selection_mode", value)
														}
														onTTLChange={(value) =>
															onChange(host.uid, "host_ttl_seconds", value)
														}
													/>
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
													<FormControl>
														<FormLabel>{t("hostsDialog.security")}</FormLabel>
														<Select
															value={host.data.security}
															onChange={(event) =>
																onChange(
																	host.uid,
																	"security",
																	event.target.value,
																)
															}
														>
															{proxyHostSecurity.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.title}
																</option>
															))}
														</Select>
													</FormControl>
													<FormControl>
														<FormLabel>{t("hostsDialog.alpn")}</FormLabel>
														<Select
															value={host.data.alpn}
															onChange={(event) =>
																onChange(host.uid, "alpn", event.target.value)
															}
														>
															{proxyALPN.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.title}
																</option>
															))}
														</Select>
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("hostsDialog.fingerprint")}
														</FormLabel>
														<Select
															value={host.data.fingerprint}
															onChange={(event) =>
																onChange(
																	host.uid,
																	"fingerprint",
																	event.target.value,
																)
															}
														>
															{proxyFingerprint.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.title}
																</option>
															))}
														</Select>
													</FormControl>
												</SimpleGrid>
											</VStack>
										</CardBody>
									</Card>

									<Card className="xray-dialog-section" variant="outline">
										<CardHeader pb={2}>
											<Text fontWeight="semibold">
												{t("hostsPage.section.advanced")}
											</Text>
										</CardHeader>
										<CardBody pt={0}>
											<VStack align="stretch" spacing={4}>
												<FormControl>
													<FormLabel>{t("hostsDialog.noise")}</FormLabel>
													<Input
														value={host.data.noise_setting}
														onChange={(event) =>
															onChange(
																host.uid,
																"noise_setting",
																event.target.value,
															)
														}
													/>
												</FormControl>
												<Stack
													direction={{ base: "column", md: "row" }}
													spacing={4}
												>
													<Checkbox
														isChecked={host.data.allowinsecure}
														onChange={(event) =>
															onChange(
																host.uid,
																"allowinsecure",
																event.target.checked,
															)
														}
													>
														{t("hostsDialog.allowinsecure")}
													</Checkbox>
													<Checkbox
														isChecked={host.data.mux_enable}
														onChange={(event) =>
															onChange(
																host.uid,
																"mux_enable",
																event.target.checked,
															)
														}
													>
														{t("hostsDialog.muxEnable")}
													</Checkbox>
													<Checkbox
														isChecked={host.data.random_user_agent}
														onChange={(event) =>
															onChange(
																host.uid,
																"random_user_agent",
																event.target.checked,
															)
														}
													>
														{t("hostsDialog.randomUserAgent")}
													</Checkbox>
													<Checkbox
														isChecked={host.data.use_sni_as_host}
														onChange={(event) =>
															onChange(
																host.uid,
																"use_sni_as_host",
																event.target.checked,
															)
														}
													>
														{t("hostsDialog.useSniAsHost")}
													</Checkbox>
												</Stack>
											</VStack>
										</CardBody>
									</Card>
								</VStack>
							</TabPanel>
							<TabPanel px={0}>
								<VStack align="stretch" spacing={3}>
									<JsonEditor
										json={jsonText}
										onChange={handleJsonEditorChange}
									/>
									{jsonError && (
										<Text fontSize="sm" color="red.500">
											{jsonError}
										</Text>
									)}
								</VStack>
							</TabPanel>
						</TabPanels>
					</Tabs>
				</XrayModalBody>
				<XrayModalFooter justifyContent="space-between">
					{isCloneMode ? (
						<Button size="sm" variant="ghost" onClick={onClose}>
							{t("hostsPage.cancel")}
						</Button>
					) : (
						<DeleteConfirmPopover
							message={t("hostsPage.deleteConfirmation")}
							isLoading={deleting}
							onConfirm={() => onDelete(host.uid)}
						>
							<Button
								size="sm"
								variant="ghost"
								colorScheme="red"
								leftIcon={<DeleteIcon />}
							>
								{t("hostsPage.delete")}
							</Button>
						</DeleteConfirmPopover>
					)}
					<HStack spacing={3}>
						{!isCloneMode && onClone && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => onClone(host.uid)}
								isDisabled={saving || deleting}
							>
								{t("hostsPage.clone")}
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							onClick={() => onReset(host.uid)}
							isDisabled={!dirty || saving}
						>
							{t("hostsPage.reset")}
						</Button>
						<Button
							size="sm"
							colorScheme="primary"
							onClick={() => onSave(host.uid)}
							isDisabled={primaryDisabled}
							isLoading={saving}
						>
							{primaryLabel}
						</Button>
					</HStack>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};

type CreateHostModalProps = {
	isOpen: boolean;
	onClose: () => void;
	inboundOptions: InboundOption[];
	onSubmit: (values: CreateHostValues) => void;
	isSubmitting: boolean;
};

const CreateHostModal: FC<CreateHostModalProps> = ({
	isOpen,
	onClose,
	inboundOptions,
	onSubmit,
	isSubmitting,
}) => {
	const { t } = useTranslation();
	const initialRef = useRef<HTMLInputElement | null>(null);
	const [formState, setFormState] = useState<CreateHostValues>({
		inboundTag: inboundOptions[0]?.value ?? "",
		remark: "",
		address: "",
		address_options: "",
		address_selection_mode: "random",
		address_ttl_seconds: null,
		port: null,
		path: "",
		sni: "",
		sni_options: "",
		sni_selection_mode: "random",
		sni_ttl_seconds: null,
		host: "",
		host_options: "",
		host_selection_mode: "random",
		host_ttl_seconds: null,
	});

	useEffect(() => {
		if (isOpen) {
			setFormState({
				inboundTag: inboundOptions[0]?.value ?? "",
				remark: "",
				address: "",
				address_options: "",
				address_selection_mode: "random",
				address_ttl_seconds: null,
				port: null,
				path: "",
				sni: "",
				sni_options: "",
				sni_selection_mode: "random",
				sni_ttl_seconds: null,
				host: "",
				host_options: "",
				host_selection_mode: "random",
				host_ttl_seconds: null,
			});
			setTimeout(() => initialRef.current?.focus(), 150);
		}
	}, [inboundOptions, isOpen]);

	const handleSubmit = () => {
		if (
			!formState.inboundTag ||
			!formState.remark.trim() ||
			(!formState.address.trim() &&
				rotationTextToOptions(formState.address_options).length === 0)
		) {
			return;
		}
		onSubmit(formState);
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="2xl"
			initialFocusRef={initialRef}
			returnFocusOnClose={false}
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3" sx={HOST_MODAL_SX}>
				<XrayModalHeader subtitle={t("hostsPage.create.description")}>
					{t("hostsPage.create.title")}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<VStack className="xray-dialog-section" align="stretch" spacing={4}>
						<Text fontSize="sm" fontWeight="semibold">
							{t("hostsPage.section.general")}
						</Text>
						<FormControl>
							<FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
							<Select
								value={formState.inboundTag}
								onChange={(event) =>
									setFormState((prev) => ({
										...prev,
										inboundTag: event.target.value,
									}))
								}
							>
								{inboundOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</Select>
						</FormControl>
						<FormControl isRequired>
							<FormLabel>{t("hostsDialog.remark")}</FormLabel>
							<InputGroup>
								<Input
									ref={initialRef}
									value={formState.remark}
									onChange={(event) =>
										setFormState((prev) => ({
											...prev,
											remark: event.target.value,
										}))
									}
								/>
								<InputRightElement width="auto" pr={2} pointerEvents="auto">
									<DynamicTokensPopover />
								</InputRightElement>
							</InputGroup>
						</FormControl>
						<FormControl isRequired>
							<FormLabel>{t("hostsDialog.address")}</FormLabel>
							<InputGroup>
								<Input
									value={formState.address}
									onChange={(event) =>
										setFormState((prev) => ({
											...prev,
											address: event.target.value,
										}))
									}
								/>
								<InputRightElement width="auto" pr={2} pointerEvents="auto">
									<DynamicTokensPopover />
								</InputRightElement>
							</InputGroup>
						</FormControl>
						<RotationFields
							label={t("hostsDialog.addressRotation", "Address rotation values")}
							value={formState.address_options}
							mode={formState.address_selection_mode}
							ttl={formState.address_ttl_seconds}
							onValueChange={(value) =>
								setFormState((prev) => ({ ...prev, address_options: value }))
							}
							onModeChange={(value) =>
								setFormState((prev) => ({
									...prev,
									address_selection_mode: value,
								}))
							}
							onTTLChange={(value) =>
								setFormState((prev) => ({
									...prev,
									address_ttl_seconds: value,
								}))
							}
						/>
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
							<FormControl>
								<FormLabel>{t("hostsDialog.port")}</FormLabel>
								<NumericInput
									value={formState.port ?? ""}
									onChange={(_, num) =>
										setFormState((prev) => ({
											...prev,
											port: Number.isNaN(num) ? null : num,
										}))
									}
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("hostsDialog.sni")}</FormLabel>
								<Input
									value={formState.sni}
									onChange={(event) =>
										setFormState((prev) => ({
											...prev,
											sni: event.target.value,
										}))
									}
								/>
							</FormControl>
						</SimpleGrid>
						<FormControl>
							<FormLabel>{t("hostsDialog.path")}</FormLabel>
							<Input
								value={formState.path}
								onChange={(event) =>
									setFormState((prev) => ({
										...prev,
										path: event.target.value,
									}))
								}
							/>
						</FormControl>
						<FormControl>
							<FormLabel>{t("hostsDialog.host")}</FormLabel>
							<InputGroup>
								<Input
									value={formState.host}
									onChange={(event) =>
										setFormState((prev) => ({
											...prev,
											host: event.target.value,
										}))
									}
								/>
								<InputRightElement width="auto" pr={2} pointerEvents="auto">
									<DynamicTokensPopover />
								</InputRightElement>
							</InputGroup>
						</FormControl>
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
							<RotationFields
								label={t("hostsDialog.sniRotation", "SNI rotation values")}
								value={formState.sni_options}
								mode={formState.sni_selection_mode}
								ttl={formState.sni_ttl_seconds}
								onValueChange={(value) =>
									setFormState((prev) => ({ ...prev, sni_options: value }))
								}
								onModeChange={(value) =>
									setFormState((prev) => ({
										...prev,
										sni_selection_mode: value,
									}))
								}
								onTTLChange={(value) =>
									setFormState((prev) => ({ ...prev, sni_ttl_seconds: value }))
								}
							/>
							<RotationFields
								label={t(
									"hostsDialog.hostRotation",
									"Request Host rotation values",
								)}
								value={formState.host_options}
								mode={formState.host_selection_mode}
								ttl={formState.host_ttl_seconds}
								onValueChange={(value) =>
									setFormState((prev) => ({ ...prev, host_options: value }))
								}
								onModeChange={(value) =>
									setFormState((prev) => ({
										...prev,
										host_selection_mode: value,
									}))
								}
								onTTLChange={(value) =>
									setFormState((prev) => ({ ...prev, host_ttl_seconds: value }))
								}
							/>
						</SimpleGrid>
					</VStack>
				</XrayModalBody>
				<XrayModalFooter justifyContent="flex-end">
					<Button variant="ghost" onClick={onClose}>
						{t("hostsPage.cancel")}
					</Button>
					<Button
						colorScheme="primary"
						onClick={handleSubmit}
						isLoading={isSubmitting}
						isDisabled={
							!formState.inboundTag ||
							!formState.remark.trim() ||
							(!formState.address.trim() &&
								rotationTextToOptions(formState.address_options).length === 0)
						}
					>
						{t("hostsPage.create.submit")}
					</Button>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
export const HostsManager: FC = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { hosts, fetchHosts, isLoading, isPostLoading, setHosts } = useHosts();
	const { inbounds } = useDashboard();
	const [_hostItemsState, setHostItemsState] = useState<HostState[]>([]);
	const hostItemsRef = useRef<HostState[]>([]);
	const applyHostItems = useCallback(
		(updater: HostState[] | ((prev: HostState[]) => HostState[])) => {
			if (typeof updater === "function") {
				setHostItemsState((prev) => {
					const next = (updater as (prev: HostState[]) => HostState[])(prev);
					hostItemsRef.current = next;
					return next;
				});
			} else {
				hostItemsRef.current = updater;
				setHostItemsState(updater);
			}
		},
		[],
	);

	const [selectedHostUid, setSelectedHostUid] = useState<string | null>(null);
	const [cloneHost, setCloneHost] = useState<HostState | null>(null);
	// Disabled hosts are hidden by default.
	const [includeDisabled, setIncludeDisabled] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [savingHostUid, setSavingHostUid] = useState<string | null>(null);
	const [deletingUid, setDeletingUid] = useState<string | null>(null);

	const showHostValidationError = useCallback(
		(errors: string[]) => {
			if (!errors.length) {
				return false;
			}
			toast({
				title: t("hostsPage.error.invalidHost", "Host config is invalid"),
				description: errors[0],
				status: "error",
				isClosable: true,
				position: "top",
			});
			return true;
		},
		[t, toast],
	);

	const viewModeStorageKey = "hostsViewMode";
	const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
		if (typeof window === "undefined") {
			return "grid";
		}
		const saved = window.localStorage.getItem(viewModeStorageKey);
		return saved === "list" ? "list" : "grid";
	});

	useEffect(() => {
		fetchHosts();
	}, [fetchHosts]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(viewModeStorageKey, viewMode);
		} catch (error) {
			console.warn("Unable to persist hosts view mode", error);
		}
	}, [viewMode]);

	useEffect(() => {
		if (!inbounds.size) {
			fetchInbounds();
		}
	}, [inbounds]);

	useEffect(() => {
		try {
			const mapped = mapHostsToState(hosts);
			applyHostItems(mapped);
		} catch (error) {
			console.error("Failed to map hosts to state:", error, hosts);
			applyHostItems([]);
		}
	}, [hosts, applyHostItems]);

	useEffect(() => {
		if (
			selectedHostUid &&
			!hostItemsRef.current.some((host) => host.uid === selectedHostUid)
		) {
			setSelectedHostUid(null);
		}
	}, [selectedHostUid]);

	const inboundOptions: InboundOption[] = useMemo(() => {
		const options: InboundOption[] = [];
		inbounds.forEach((list) => {
			list.forEach((inbound) => {
				options.push({
					label: `${inbound.tag} (${inbound.protocol.toUpperCase()} - ${inbound.network})`,
					value: inbound.tag,
					protocol: inbound.protocol,
					network: inbound.network,
				});
			});
		});
		return options.sort((a, b) => a.label.localeCompare(b.label));
	}, [inbounds]);

	const activeHosts = useMemo(
		() => sortHosts(_hostItemsState.filter((host) => !host.data.is_disabled)),
		[_hostItemsState],
	);

	const allHosts = useMemo(
		() => sortHosts(_hostItemsState),
		[_hostItemsState],
	);

	const baseFilteredHosts = useMemo(
		() => (includeDisabled ? allHosts : activeHosts),
		[activeHosts, allHosts, includeDisabled],
	);

	const normalizedSearchQuery = searchQuery.trim().toLowerCase();

	const filteredHosts = useMemo(() => {
		if (!normalizedSearchQuery) {
			return baseFilteredHosts;
		}
		return baseFilteredHosts.filter((host) => {
			const values = [
				host.data.remark,
				host.data.address,
				host.data.host,
				host.data.path,
				host.data.sni,
				host.inboundTag,
				host.data.port != null ? String(host.data.port) : "",
			];
			return values.some((value) =>
				value?.toLowerCase().includes(normalizedSearchQuery),
			);
		});
	}, [baseFilteredHosts, normalizedSearchQuery]);

	const displayedHosts = filteredHosts;

	const hasLoadedHosts = hostItemsRef.current.length > 0;
	const isInitialLoading = isLoading && !hasLoadedHosts;
	const isRefreshing = isLoading && hasLoadedHosts;
	const isSearchActive = normalizedSearchQuery.length > 0;
	const showSearchEmptyState =
		!isInitialLoading &&
		isSearchActive &&
		baseFilteredHosts.length > 0 &&
		filteredHosts.length === 0;

	const selectedHost = selectedHostUid
		? (hostItemsRef.current.find((host) => host.uid === selectedHostUid) ??
			null)
		: null;

	const updateHost = <Key extends keyof HostData>(
		uid: string,
		key: Key,
		value: HostData[Key],
	) => {
		applyHostItems((prev) =>
			sortHosts(
				prev.map((host) =>
					host.uid === uid
						? { ...host, data: { ...host.data, [key]: value } }
						: host,
				),
			),
		);
	};

	const updateHostInbound = (uid: string, inboundTag: string) => {
		applyHostItems((prev) =>
			sortHosts(
				prev.map((host) =>
					host.uid === uid
						? {
								...host,
								inboundTag,
							}
						: host,
				),
			),
		);
	};

	const saveHost = async (uid: string) => {
		const host = hostItemsRef.current.find((item) => item.uid === uid);
		if (!host) return;
		if (showHostValidationError(validateHostState(host.inboundTag, host.data))) {
			return;
		}
		setSavingHostUid(uid);
		try {
			const payload = buildInboundPayload(hostItemsRef.current, [
				host.inboundTag,
				host.initialInboundTag,
			]);
			await setHosts(payload);
			await fetchHosts();
			toast({
				title: t("hostsPage.saved"),
				status: "success",
				isClosable: true,
				position: "top",
			});
			setSelectedHostUid(null);
		} catch (_error) {
			toast({
				title: t("hostsPage.error.save"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setSavingHostUid(null);
		}
	};

	const resetHost = (uid: string) => {
		applyHostItems((prev) =>
			sortHosts(
				prev.map((host) =>
					host.uid === uid
						? {
								...host,
								inboundTag: host.initialInboundTag,
								data: cloneHostData(host.original),
							}
						: host,
				),
			),
		);
	};

	const openCloneModal = useCallback((uid: string) => {
		const source = hostItemsRef.current.find((item) => item.uid === uid);
		if (!source) return;
		const baseData = { ...cloneHostData(source.data), id: null };
		const cloneState: HostState = {
			uid: createUid(),
			inboundTag: source.inboundTag,
			initialInboundTag: source.inboundTag,
			data: cloneHostData(baseData),
			original: cloneHostData(baseData),
		};
		setSelectedHostUid(null);
		setCloneHost(cloneState);
	}, []);

	const updateCloneHost = <Key extends keyof HostData>(
		uid: string,
		key: Key,
		value: HostData[Key],
	) => {
		setCloneHost((prev) =>
			prev && prev.uid === uid
				? { ...prev, data: { ...prev.data, [key]: value } }
				: prev,
		);
	};

	const updateCloneInbound = (uid: string, inboundTag: string) => {
		setCloneHost((prev) =>
			prev && prev.uid === uid ? { ...prev, inboundTag } : prev,
		);
	};

	const resetCloneHost = (uid: string) => {
		setCloneHost((prev) =>
			prev && prev.uid === uid
				? {
						...prev,
						inboundTag: prev.initialInboundTag,
						data: cloneHostData(prev.original),
					}
				: prev,
		);
	};

	const addCloneHost = async (uid: string) => {
		if (!cloneHost || cloneHost.uid !== uid) return;
		if (
			showHostValidationError(
				validateHostState(cloneHost.inboundTag, cloneHost.data),
			)
		) {
			return;
		}
		const remark = cloneHost.data.remark.trim();
		const address =
			cloneHost.data.address.trim() ||
			rotationTextToOptions(cloneHost.data.address_options)[0] ||
			"";
		if (!cloneHost.inboundTag || !remark || !address) {
			toast({
				title: t("hostsPage.clone.error"),
				status: "error",
				isClosable: true,
				position: "top",
			});
			return;
		}

		const newData: HostData = {
			...cloneHostData(cloneHost.data),
			id: null,
			remark,
			address,
		};
		const previousHosts = hostItemsRef.current;
		const newHost: HostState = {
			uid: createUid(),
			inboundTag: cloneHost.inboundTag,
			initialInboundTag: cloneHost.inboundTag,
			data: cloneHostData(newData),
			original: cloneHostData(newData),
		};

		setSavingHostUid(uid);
		try {
			const nextHosts = sortHosts([...previousHosts, newHost]);
			applyHostItems(nextHosts);
			const payload = buildInboundPayload(nextHosts, [cloneHost.inboundTag]);
			await setHosts(payload);
			await fetchHosts();
			toast({
				title: t("hostsPage.clone.created"),
				status: "success",
				isClosable: true,
				position: "top",
			});
			setCloneHost(null);
		} catch (_error) {
			applyHostItems(previousHosts);
			toast({
				title: t("hostsPage.clone.error"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setSavingHostUid(null);
		}
	};

	const toggleActive = async (uid: string, isActive: boolean) => {
		if (isPostLoading) {
			return;
		}
		const previousHosts = hostItemsRef.current;
		const nextHosts = sortHosts(
			previousHosts.map((host) =>
				host.uid === uid
					? { ...host, data: { ...host.data, is_disabled: !isActive } }
					: host,
			),
		);
		applyHostItems(nextHosts);
		if (!isActive) {
			setIncludeDisabled(true);
		}
		setSavingHostUid(uid);
		try {
			const updatedHost = nextHosts.find((host) => host.uid === uid);
			if (!updatedHost) {
				throw new Error("Host not found");
			}
			const payload = groupHostsByInbound(nextHosts);
			await setHosts(payload);
			await fetchHosts();
		} catch (_error) {
			applyHostItems(previousHosts);
			toast({
				title: t("hostsPage.error.save"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setSavingHostUid(null);
		}
	};

	const handleDeleteHost = async (uid: string) => {
		const host = hostItemsRef.current.find((item) => item.uid === uid);
		if (!host) return;
		setDeletingUid(uid);
		try {
			const nextHosts = hostItemsRef.current.filter((item) => item.uid !== uid);
			applyHostItems(nextHosts);
			const payload = buildInboundPayload(nextHosts, [
				host.inboundTag,
				host.initialInboundTag,
			]);
			await setHosts(payload);
			await fetchHosts();
			toast({
				title: t("hostsPage.deleted"),
				status: "success",
				isClosable: true,
				position: "top",
			});
			if (selectedHostUid === uid) {
				setSelectedHostUid(null);
			}
		} catch (_error) {
			toast({
				title: t("hostsPage.error.delete"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setDeletingUid(null);
		}
	};

	const handleCreateHost = async (values: CreateHostValues) => {
		if (showHostValidationError(validateHostState(values.inboundTag, values))) {
			return;
		}
		setSavingHostUid("create");
		try {
			const newHost: HostState = {
				uid: createUid(),
				inboundTag: values.inboundTag,
				initialInboundTag: values.inboundTag,
				data: {
					id: null,
					remark: values.remark,
					address: values.address,
					address_options: values.address_options,
					address_selection_mode: values.address_selection_mode,
					address_ttl_seconds: values.address_ttl_seconds,
					port: values.port,
					path: values.path,
					sni: values.sni,
					sni_options: values.sni_options,
					sni_selection_mode: values.sni_selection_mode,
					sni_ttl_seconds: values.sni_ttl_seconds,
					host: values.host,
					host_options: values.host_options,
					host_selection_mode: values.host_selection_mode,
					host_ttl_seconds: values.host_ttl_seconds,
					mux_enable: false,
					allowinsecure: false,
					is_disabled: false,
					fragment_setting: "",
					noise_setting: "",
					random_user_agent: false,
					security: "inbound_default",
					alpn: "",
					fingerprint: "",
					use_sni_as_host: false,
				},
				original: {
					id: null,
					remark: values.remark,
					address: values.address,
					address_options: values.address_options,
					address_selection_mode: values.address_selection_mode,
					address_ttl_seconds: values.address_ttl_seconds,
					port: values.port,
					path: values.path,
					sni: values.sni,
					sni_options: values.sni_options,
					sni_selection_mode: values.sni_selection_mode,
					sni_ttl_seconds: values.sni_ttl_seconds,
					host: values.host,
					host_options: values.host_options,
					host_selection_mode: values.host_selection_mode,
					host_ttl_seconds: values.host_ttl_seconds,
					mux_enable: false,
					allowinsecure: false,
					is_disabled: false,
					fragment_setting: "",
					noise_setting: "",
					random_user_agent: false,
					security: "inbound_default",
					alpn: "",
					fingerprint: "",
					use_sni_as_host: false,
				},
			};

			const nextHosts = sortHosts([...hostItemsRef.current, newHost]);
			applyHostItems(nextHosts);

			const payload = buildInboundPayload(nextHosts, [values.inboundTag]);
			await setHosts(payload);
			await fetchHosts();
			toast({
				title: t("hostsPage.created"),
				status: "success",
				isClosable: true,
				position: "top",
			});
			setCreateOpen(false);
		} catch (_error) {
			toast({
				title: t("hostsPage.error.create"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setSavingHostUid(null);
		}
	};

	return (
		<VStack align="stretch" spacing={4}>
			<Stack
				direction={{ base: "column", md: "row" }}
				spacing={3}
				align={{ base: "stretch", md: "center" }}
				justify="space-between"
			>
				<HStack spacing={3} flexWrap="wrap">
					<Button
						colorScheme="primary"
						size="sm"
						onClick={() => setCreateOpen(true)}
						leftIcon={<AddIcon />}
						isDisabled={!inboundOptions.length}
					>
						{t("hostsPage.addHost")}
					</Button>
					<Switch
						isChecked={includeDisabled}
						onChange={(event) => setIncludeDisabled(event.target.checked)}
					>
						{t("hostsPage.showDisabled")}
					</Switch>
				</HStack>
				<Stack
					direction={{ base: "column", sm: "row" }}
					spacing={2}
					align={{ base: "stretch", sm: "center" }}
					justify="flex-end"
					w="full"
				>
					<Input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder={t("hostsPage.searchPlaceholder")}
						size="sm"
						w="100%"
					/>
					<HStack spacing={2} justify="flex-end">
						{isRefreshing && <Spinner size="sm" />}
						<Tooltip label={t("hostsPage.viewList", "List view")}>
							<IconButton
								aria-label={t("hostsPage.viewList", "List view")}
								icon={<ListViewIcon />}
								variant={viewMode === "list" ? "solid" : "ghost"}
								colorScheme={viewMode === "list" ? "primary" : undefined}
								size="sm"
								onClick={() => setViewMode("list")}
							/>
						</Tooltip>
						<Tooltip label={t("hostsPage.viewGrid", "Grid view")}>
							<IconButton
								aria-label={t("hostsPage.viewGrid", "Grid view")}
								icon={<GridViewIcon />}
								variant={viewMode === "grid" ? "solid" : "ghost"}
								colorScheme={viewMode === "grid" ? "primary" : undefined}
								size="sm"
								onClick={() => setViewMode("grid")}
							/>
						</Tooltip>
					</HStack>
				</Stack>
			</Stack>

			{isInitialLoading ? (
				<HStack justify="center" py={10}>
					<Spinner />
				</HStack>
			) : displayedHosts.length === 0 ? (
				<Box
					border="1px dashed"
					borderRadius="md"
					px={6}
					py={10}
					textAlign="center"
					borderColor="gray.300"
					_dark={{ borderColor: "gray.600" }}
				>
					<Text>
						{showSearchEmptyState
							? t("hostsPage.searchEmpty")
							: t("hostsPage.emptyState")}
					</Text>
				</Box>
			) : viewMode === "list" ? (
				<VStack align="stretch" spacing={3}>
					{displayedHosts.map((host) => (
						<HostListRow
							key={host.uid}
							host={host}
							inboundOptions={inboundOptions}
							onToggleActive={toggleActive}
							onEdit={setSelectedHostUid}
							onDelete={handleDeleteHost}
							saving={savingHostUid === host.uid && isPostLoading}
							deleting={deletingUid === host.uid && isPostLoading}
						/>
					))}
				</VStack>
			) : (
				<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
					{displayedHosts.map((host) => (
						<HostCard
							key={host.uid}
							host={host}
							inboundOptions={inboundOptions}
							onToggleActive={toggleActive}
							onEdit={setSelectedHostUid}
							onDelete={handleDeleteHost}
							saving={savingHostUid === host.uid && isPostLoading}
							deleting={deletingUid === host.uid && isPostLoading}
						/>
					))}
				</SimpleGrid>
			)}

			<CreateHostModal
				isOpen={createOpen}
				onClose={() => setCreateOpen(false)}
				inboundOptions={inboundOptions}
				onSubmit={handleCreateHost}
				isSubmitting={savingHostUid === "create" && isPostLoading}
			/>

			<HostDetailModal
				host={selectedHost}
				inboundOptions={inboundOptions}
				isOpen={Boolean(selectedHost)}
				onClose={() => setSelectedHostUid(null)}
				onChange={updateHost}
				onChangeInbound={updateHostInbound}
				onSave={saveHost}
				onReset={resetHost}
				onDelete={handleDeleteHost}
				onClone={openCloneModal}
				saving={
					!!selectedHost && savingHostUid === selectedHost.uid && isPostLoading
				}
				deleting={
					!!selectedHost && deletingUid === selectedHost.uid && isPostLoading
				}
			/>

			<HostDetailModal
				host={cloneHost}
				inboundOptions={inboundOptions}
				isOpen={Boolean(cloneHost)}
				onClose={() => setCloneHost(null)}
				onChange={updateCloneHost}
				onChangeInbound={updateCloneInbound}
				onSave={addCloneHost}
				onReset={resetCloneHost}
				onDelete={() => {}}
				mode="clone"
				saving={!!cloneHost && savingHostUid === cloneHost.uid && isPostLoading}
				deleting={false}
			/>
		</VStack>
	);
};

export default HostsManager;
