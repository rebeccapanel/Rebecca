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
	Input,
	InputGroup,
	InputRightElement,
	MenuItem,
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
	SimpleGrid,
	Stack,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Tag,
	Text,
	Tooltip,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	CheckCircleIcon,
	InformationCircleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
	XCircleIcon,
} from "@heroicons/react/24/outline";
import {
	proxyALPN,
	proxyFingerprint,
	proxyHostSecurity,
} from "constants/Proxies";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type HostsSchema, useHosts } from "contexts/HostsContext";
import { type NodeType, useNodesQuery } from "contexts/NodesContext";
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
import {
	MultiValueAutocomplete,
	type MultiValueAutocompleteOption,
} from "./common/MultiValueAutocomplete";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import { DeleteIcon } from "./common/DeleteIcon";
import { DeleteConfirmDialog } from "./dialogs/ConfirmDialog";
import { JsonEditor } from "./JsonEditor";
import {
	DataTable,
	ResourceListCard,
	ResourceRefreshButton,
	type DataTableColumn,
	type DataTableRowAction,
	type ResourceSummaryItem,
} from "./ui";
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
	dns_primary: string;
	dns_secondary: string;
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
	dns_primary: "1.1.1.1",
	dns_secondary: "8.8.8.8",
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
	port?: number;
};

type CreateHostValues = {
	inboundTag: string;
	remark: string;
	address: string;
	dns_primary: string;
	dns_secondary: string;
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

type RotationControlsProps = {
	mode: string;
	ttl: number | null;
	onModeChange: (value: string) => void;
	onTTLChange: (value: number | null) => void;
};

const RotationControls: FC<RotationControlsProps> = ({
	mode,
	ttl,
	onModeChange,
	onTTLChange,
}) => {
	const { t } = useTranslation();
	return (
		<SimpleGrid columns={2} spacing={2} mt={2}>
			<FormControl>
				<FormLabel fontSize="xs" color="gray.500" mb={1}>
					{t("hostsDialog.rotationMode", "Selection mode")}
				</FormLabel>
				<SearchableTagSelect
					size="sm"
					value={mode}
					options={[
						{
							value: "random",
							label: t("hostsDialog.rotationRandom", "Random"),
						},
						{ value: "ttl", label: t("hostsDialog.rotationTTL", "TTL") },
					]}
					placeholder={t("hostsDialog.rotationMode", "Selection mode")}
					onChange={(value) => onModeChange(String(value))}
				/>
			</FormControl>
			<FormControl>
				<FormLabel fontSize="xs" color="gray.500" mb={1}>
					{t("hostsDialog.rotationTTLSeconds", "TTL seconds")}
				</FormLabel>
				<NumericInput
					size="sm"
					value={ttl ?? ""}
					min={1}
					max={2592000}
					fieldProps={{ placeholder: "120" }}
					isDisabled={mode !== "ttl"}
					onChange={(_, num) => onTTLChange(Number.isNaN(num) ? null : num)}
				/>
			</FormControl>
		</SimpleGrid>
	);
};

const shortNodeName = (name?: string | null) => {
	const trimmed = (name ?? "").trim();
	if (!trimmed) return "Node";
	return trimmed.length > 5 ? `${trimmed.slice(0, 5)}...` : trimmed;
};

const getNodeAddressOptions = (
	nodes?: NodeType[],
): MultiValueAutocompleteOption[] =>
	(nodes ?? [])
		.filter((node) => node.status !== "disabled")
		.reduce<MultiValueAutocompleteOption[]>((options, node) => {
			const address =
				typeof node.address === "string" ? node.address.trim() : "";
			if (!address) return options;
			const fullName = String(node.name ?? "").trim();
			const labelName = shortNodeName(fullName);
			options.push({
				label: `${labelName} - ${address}`,
				title: fullName ? `${fullName} - ${address}` : address,
				value: address,
			});
			return options;
		}, []);

const HOST_MODAL_SX = {
	".xray-dialog-section .chakra-form-control": {
		display: "block",
	},
	".xray-dialog-section .chakra-form__label": {
		whiteSpace: "nowrap",
		mb: 1.5,
	},
};

const alpnAutocompleteOptions = proxyALPN
	.map((option) => option.value)
	.filter(Boolean);

const inboundPortPlaceholder = (inbound?: InboundOption) =>
	inbound?.port ? `Inbound default: ${inbound.port}` : "Inherited from inbound";

type FragmentFields = {
	length: string;
	interval: string;
	packet: string;
	maxSplit: string;
};

const parseFragmentSetting = (value: string): FragmentFields => {
	const [length = "", interval = "", packet = "", maxSplit = ""] = value
		.split(",")
		.map((item) => item.trim());
	return { length, interval, packet, maxSplit };
};

const formatFragmentSetting = (fields: FragmentFields) => {
	const length = fields.length.trim();
	const interval = fields.interval.trim();
	const packet = fields.packet.trim();
	const maxSplit = fields.maxSplit.trim();
	if (!length && !interval && !packet && !maxSplit) return "";
	const parts = [
		length || "10-100",
		interval || "100-200",
		packet || "tlshello",
	];
	if (maxSplit) parts.push(maxSplit);
	return parts.join(",");
};

type NoisePattern = {
	type: string;
	packet: string;
	delay: string;
};

const defaultNoisePattern = (): NoisePattern => ({
	type: "rand",
	packet: "10-20",
	delay: "100-200",
});

const parseNoiseSetting = (value: string): NoisePattern[] => {
	const patterns = value
		.split("&")
		.map((raw) => raw.trim())
		.filter(Boolean)
		.map((raw) => {
			const colonIndex = raw.indexOf(":");
			const type = colonIndex > 0 ? raw.slice(0, colonIndex).trim() : "rand";
			const rest = colonIndex > 0 ? raw.slice(colonIndex + 1) : raw;
			const [packet = "", delay = ""] = rest
				.split(",")
				.map((item) => item.trim());
			return {
				type: ["rand", "str", "hex", "base64"].includes(type) ? type : "rand",
				packet: packet || "10-20",
				delay: delay || "100-200",
			};
		});
	return patterns.length ? patterns : [defaultNoisePattern()];
};

const formatNoiseSetting = (patterns: NoisePattern[]) =>
	patterns
		.map((pattern) => ({
			type: pattern.type || "rand",
			packet: pattern.packet.trim(),
			delay: pattern.delay.trim(),
		}))
		.filter((pattern) => pattern.packet)
		.map((pattern) =>
			pattern.delay
				? `${pattern.type}:${pattern.packet},${pattern.delay}`
				: `${pattern.type}:${pattern.packet}`,
		)
		.join("&");

const FragmentSettingFields: FC<{
	value: string;
	onChange: (value: string) => void;
}> = ({ value, onChange }) => {
	const { t } = useTranslation();
	const fields = parseFragmentSetting(value);
	const isEnabled = value.trim() !== "";
	const update = (patch: Partial<FragmentFields>) => {
		onChange(formatFragmentSetting({ ...fields, ...patch }));
	};
	return (
		<Box>
			<Checkbox
				isChecked={isEnabled}
				onChange={(event) =>
					onChange(
						event.target.checked
							? formatFragmentSetting(
									parseFragmentSetting("10-100,100-200,tlshello"),
								)
							: "",
					)
				}
			>
				{t("hostsDialog.fragment", "Fragment pattern")}
			</Checkbox>
			{isEnabled && (
				<Box mt={2} pl={{ base: 0, md: 6 }}>
					<SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} spacing={2}>
						<FormControl>
							<FormLabel fontSize="xs" color="gray.500" mb={1}>
								{t("hostsDialog.fragmentLengthLabel", "Length")}
							</FormLabel>
							<Input
								size="sm"
								value={fields.length}
								placeholder={t("hostsDialog.fragmentLength", "10-100")}
								onChange={(event) => update({ length: event.target.value })}
							/>
						</FormControl>
						<FormControl>
							<FormLabel fontSize="xs" color="gray.500" mb={1}>
								{t("hostsDialog.fragmentIntervalLabel", "Interval")}
							</FormLabel>
							<Input
								size="sm"
								value={fields.interval}
								placeholder={t("hostsDialog.fragmentInterval", "100-200")}
								onChange={(event) => update({ interval: event.target.value })}
							/>
						</FormControl>
						<FormControl>
							<FormLabel fontSize="xs" color="gray.500" mb={1}>
								{t("hostsDialog.fragmentPacketLabel", "Packet")}
							</FormLabel>
							<Input
								size="sm"
								value={fields.packet}
								placeholder={t("hostsDialog.fragmentPacket", "tlshello")}
								onChange={(event) => update({ packet: event.target.value })}
							/>
						</FormControl>
						<FormControl>
							<FormLabel fontSize="xs" color="gray.500" mb={1}>
								{t("hostsDialog.fragmentMaxSplitLabel", "Max split")}
							</FormLabel>
							<Input
								size="sm"
								value={fields.maxSplit}
								placeholder={t("hostsDialog.fragmentMaxSplit", "3")}
								onChange={(event) => update({ maxSplit: event.target.value })}
							/>
						</FormControl>
					</SimpleGrid>
					<Text mt={1.5} fontSize="xs" color="gray.500">
						{t(
							"hostsDialog.fragmentHint",
							"Saved as length,interval,packet. Example: 10-100,100-200,tlshello",
						)}
					</Text>
				</Box>
			)}
		</Box>
	);
};

const NoisePatternFields: FC<{
	value: string;
	onChange: (value: string) => void;
}> = ({ value, onChange }) => {
	const { t } = useTranslation();
	const patterns = parseNoiseSetting(value);
	const isEnabled = value.trim() !== "";
	const updatePatterns = (next: NoisePattern[]) =>
		onChange(formatNoiseSetting(next));
	const updatePattern = (index: number, patch: Partial<NoisePattern>) => {
		updatePatterns(
			patterns.map((pattern, patternIndex) =>
				patternIndex === index ? { ...pattern, ...patch } : pattern,
			),
		);
	};
	return (
		<Box>
			<Stack
				direction={{ base: "column", sm: "row" }}
				spacing={2}
				align={{ base: "stretch", sm: "center" }}
				justify="space-between"
			>
				<Checkbox
					isChecked={isEnabled}
					onChange={(event) =>
						onChange(
							event.target.checked
								? formatNoiseSetting([defaultNoisePattern()])
								: "",
						)
					}
				>
					{t("hostsDialog.noise", "Noise pattern")}
				</Checkbox>
				{isEnabled && (
					<Button
						size="xs"
						variant="outline"
						alignSelf={{ base: "flex-start", sm: "center" }}
						onClick={() => updatePatterns([...patterns, defaultNoisePattern()])}
					>
						{t("hostsDialog.addNoisePattern", "Add pattern")}
					</Button>
				)}
			</Stack>
			{isEnabled && (
				<Box mt={2} pl={{ base: 0, md: 6 }}>
					<VStack align="stretch" spacing={2}>
						{patterns.map((pattern, index) => (
							<SimpleGrid
								key={`${index}-${pattern.type}`}
								columns={{ base: 1, md: 12 }}
								spacing={2}
								alignItems="end"
							>
								<FormControl gridColumn={{ md: "span 3" }}>
									<FormLabel fontSize="xs" color="gray.500" mb={1}>
										{t("hostsDialog.noiseType", "Type")}
									</FormLabel>
									<SearchableTagSelect
										size="sm"
										value={pattern.type}
										options={["rand", "str", "hex", "base64"]}
										placeholder={t("hostsDialog.noiseType", "Type")}
										onChange={(value) =>
											updatePattern(index, { type: String(value) })
										}
									/>
								</FormControl>
								<FormControl gridColumn={{ md: "span 4" }}>
									<FormLabel fontSize="xs" color="gray.500" mb={1}>
										{t("hostsDialog.noisePacketLabel", "Packet/value")}
									</FormLabel>
									<Input
										size="sm"
										value={pattern.packet}
										placeholder={
											pattern.type === "rand"
												? "10-20"
												: t("hostsDialog.noisePacket", "Packet/value")
										}
										onChange={(event) =>
											updatePattern(index, { packet: event.target.value })
										}
									/>
								</FormControl>
								<FormControl gridColumn={{ md: "span 4" }}>
									<FormLabel fontSize="xs" color="gray.500" mb={1}>
										{t("hostsDialog.noiseDelay", "Delay")}
									</FormLabel>
									<Input
										size="sm"
										value={pattern.delay}
										placeholder="100-200"
										onChange={(event) =>
											updatePattern(index, { delay: event.target.value })
										}
									/>
								</FormControl>
								<Button
									size="sm"
									variant="ghost"
									colorScheme="red"
									isDisabled={patterns.length === 1}
									onClick={() =>
										updatePatterns(
											patterns.filter(
												(_, patternIndex) => patternIndex !== index,
											),
										)
									}
									gridColumn={{ md: "span 1" }}
								>
									×
								</Button>
							</SimpleGrid>
						))}
					</VStack>
					<Text mt={1.5} fontSize="xs" color="gray.500">
						{t(
							"hostsDialog.noiseHint",
							"Saved as noise patterns. Example: rand:10-20,100-200&str:hello,50",
						)}
					</Text>
				</Box>
			)}
		</Box>
	);
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
	(values ?? [])
		.map((value) => value.trim())
		.filter(Boolean)
		.join("\n");

const rotationTextToOptions = (value: string) =>
	value
		.split(/\r?\n|,/)
		.map((item) => item.trim())
		.filter(Boolean);

const mergeRotationValue = (
	value: string | null | undefined,
	options: string[] | null | undefined,
) =>
	rotationTextToOptions([value ?? "", ...(options ?? [])].join(",")).join(", ");

const hasMultipleRotationValues = (value: string) =>
	rotationTextToOptions(value).length > 1;

const normalizeBoolean = (
	value: boolean | null | undefined,
	fallback = false,
) => (typeof value === "boolean" ? value : fallback);

const normalizeHostData = (host: HostsSchema[string][number]): HostData => ({
	id: host.id ?? null,
	remark: host.remark ?? "",
	address: mergeRotationValue(host.address, host.address_options),
	dns_primary: normalizeString(host.dns_primary) || "1.1.1.1",
	dns_secondary: normalizeString(host.dns_secondary) || "8.8.8.8",
	address_options: "",
	address_selection_mode: normalizeRotationMode(host.address_selection_mode),
	address_ttl_seconds: host.address_ttl_seconds ?? null,
	port: host.port ?? null,
	path: normalizeString(host.path),
	sni: mergeRotationValue(host.sni, host.sni_options),
	sni_options: "",
	sni_selection_mode: normalizeRotationMode(host.sni_selection_mode),
	sni_ttl_seconds: host.sni_ttl_seconds ?? null,
	host: mergeRotationValue(host.host, host.host_options),
	host_options: "",
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
	dns_primary: data.dns_primary,
	dns_secondary: data.dns_secondary,
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
	if (
		!data.address.trim() &&
		rotationTextToOptions(data.address_options).length === 0
	) {
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
	for (const [label, value] of [
		["Primary DNS", data.dns_primary],
		["Secondary DNS", data.dns_secondary],
	] as const) {
		if (!value.trim()) {
			errors.push(`${label} is required.`);
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
	return {
		id: data.id ?? null,
		remark: data.remark.trim(),
		address: rotationTextToOptions(data.address).join(", "),
		dns_primary: data.dns_primary.trim(),
		dns_secondary: data.dns_secondary.trim(),
		address_options: [],
		address_selection_mode: normalizeRotationMode(data.address_selection_mode),
		address_ttl_seconds: data.address_ttl_seconds ?? null,
		port: data.port,
		path: data.path.trim() ? data.path.trim() : null,
		sni: rotationTextToOptions(data.sni).join(", ") || null,
		sni_options: [],
		sni_selection_mode: normalizeRotationMode(data.sni_selection_mode),
		sni_ttl_seconds: data.sni_ttl_seconds ?? null,
		host: rotationTextToOptions(data.host).join(", ") || null,
		host_options: [],
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
	nodes?: NodeType[];
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
	nodes,
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
	const selectedInbound = useMemo(
		() =>
			host
				? inboundOptions.find((option) => option.value === host.inboundTag)
				: undefined,
		[inboundOptions, host],
	);
	const isWireGuardInbound = selectedInbound?.protocol === "wireguard";
	const canSubmit = host
		? Boolean(
				host.inboundTag &&
					host.data.remark.trim() &&
					(host.data.address.trim() ||
						rotationTextToOptions(host.data.address_options).length > 0) &&
					(!isWireGuardInbound ||
						(host.data.dns_primary.trim() &&
							host.data.dns_secondary.trim())),
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
	const nodeAddressOptions = useMemo(
		() => getNodeAddressOptions(nodes),
		[nodes],
	);
	const isVirtualTunnelInbound =
		selectedInbound?.protocol === "openvpn" ||
		selectedInbound?.protocol === "l2tp";
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
												<FormControl isRequired>
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
													<FormControl isRequired>
														<FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
														<SearchableTagSelect
															value={host.inboundTag}
															options={inboundOptions}
															placeholder={t("hostsPage.inboundLabel")}
															onChange={(value) =>
																onChangeInbound(host.uid, String(value))
															}
														/>
													</FormControl>
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl isRequired>
														<FormLabel>{t("hostsDialog.address")}</FormLabel>
														<MultiValueAutocomplete
															value={host.data.address}
															options={nodeAddressOptions}
															placeholder={t(
																"hostsDialog.addressPlaceholder",
																"Type an address or select node IPs",
															)}
															onChange={(value) =>
																onChange(host.uid, "address", value)
															}
															rightElement={<DynamicTokensPopover />}
														/>
													</FormControl>
													{!isVirtualTunnelInbound && (
														<FormControl>
															<FormLabel>{t("hostsDialog.port")}</FormLabel>
															<NumericInput
																value={host.data.port ?? ""}
																allowMouseWheel
																fieldProps={{
																	placeholder:
																		inboundPortPlaceholder(selectedInbound),
																}}
																onChange={(_, num) =>
																	onChange(
																		host.uid,
																		"port",
																		Number.isNaN(num) ? null : num,
																	)
																}
															/>
														</FormControl>
													)}
												</SimpleGrid>
												{hasMultipleRotationValues(host.data.address) && (
													<RotationControls
														mode={host.data.address_selection_mode}
														ttl={host.data.address_ttl_seconds}
														onModeChange={(value) =>
															onChange(
																host.uid,
																"address_selection_mode",
																value,
															)
														}
														onTTLChange={(value) =>
															onChange(host.uid, "address_ttl_seconds", value)
														}
													/>
												)}
												{isWireGuardInbound && (
													<SimpleGrid
														columns={{ base: 1, md: 2 }}
														spacing={4}
													>
														<FormControl isRequired>
															<FormLabel>{t("hostsDialog.dnsPrimary")}</FormLabel>
															<Input
																value={host.data.dns_primary}
																placeholder="1.1.1.1"
																onChange={(event) =>
																	onChange(
																		host.uid,
																		"dns_primary",
																		event.target.value,
																	)
																}
															/>
														</FormControl>
														<FormControl isRequired>
															<FormLabel>{t("hostsDialog.dnsSecondary")}</FormLabel>
															<Input
																value={host.data.dns_secondary}
																placeholder="8.8.8.8"
																onChange={(event) =>
																	onChange(
																		host.uid,
																		"dns_secondary",
																		event.target.value,
																	)
																}
															/>
														</FormControl>
													</SimpleGrid>
												)}
												{!isVirtualTunnelInbound && (
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
												)}
											</VStack>
										</CardBody>
									</Card>

									{!isVirtualTunnelInbound && (
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
														<MultiValueAutocomplete
															value={host.data.sni}
															placeholder={t(
																"hostsDialog.sniPlaceholder",
																"Type SNI values",
															)}
															onChange={(value) =>
																onChange(host.uid, "sni", value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>{t("hostsDialog.host")}</FormLabel>
														<MultiValueAutocomplete
															value={host.data.host}
															placeholder={t(
																"hostsDialog.hostPlaceholder",
																"Type request host values",
															)}
															onChange={(value) =>
																onChange(host.uid, "host", value)
															}
															rightElement={<DynamicTokensPopover />}
														/>
													</FormControl>
												</SimpleGrid>
												{(hasMultipleRotationValues(host.data.sni) ||
													hasMultipleRotationValues(host.data.host)) && (
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
														{hasMultipleRotationValues(host.data.sni) && (
															<RotationControls
																mode={host.data.sni_selection_mode}
																ttl={host.data.sni_ttl_seconds}
																onModeChange={(value) =>
																	onChange(
																		host.uid,
																		"sni_selection_mode",
																		value,
																	)
																}
																onTTLChange={(value) =>
																	onChange(host.uid, "sni_ttl_seconds", value)
																}
															/>
														)}
														{hasMultipleRotationValues(host.data.host) && (
															<RotationControls
																mode={host.data.host_selection_mode}
																ttl={host.data.host_ttl_seconds}
																onModeChange={(value) =>
																	onChange(
																		host.uid,
																		"host_selection_mode",
																		value,
																	)
																}
																onTTLChange={(value) =>
																	onChange(host.uid, "host_ttl_seconds", value)
																}
															/>
														)}
													</SimpleGrid>
												)}
												<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
													<FormControl>
														<FormLabel>{t("hostsDialog.security")}</FormLabel>
														<SearchableTagSelect
															value={host.data.security}
															options={proxyHostSecurity.map((option) => ({
																value: option.value,
																label: option.title,
															}))}
															placeholder={t("hostsDialog.security")}
															onChange={(value) =>
																onChange(host.uid, "security", String(value))
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>{t("hostsDialog.alpn")}</FormLabel>
														<MultiValueAutocomplete
															value={host.data.alpn}
															options={alpnAutocompleteOptions}
															placeholder={t(
																"hostsDialog.alpnPlaceholder",
																"Select or type ALPN values",
															)}
															onChange={(value) =>
																onChange(host.uid, "alpn", value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("hostsDialog.fingerprint")}
														</FormLabel>
														<SearchableTagSelect
															value={host.data.fingerprint}
															options={proxyFingerprint.map((option) => ({
																value: option.value,
																label: option.title,
															}))}
															placeholder={t("hostsDialog.fingerprint")}
															onChange={(value) =>
																onChange(host.uid, "fingerprint", String(value))
															}
														/>
													</FormControl>
												</SimpleGrid>
											</VStack>
										</CardBody>
									</Card>
									)}

									{!isVirtualTunnelInbound && (
									<Card className="xray-dialog-section" variant="outline">
										<CardHeader pb={2}>
											<Text fontWeight="semibold">
												{t("hostsPage.section.advanced")}
											</Text>
										</CardHeader>
										<CardBody pt={0}>
											<VStack align="stretch" spacing={4}>
												<FragmentSettingFields
													value={host.data.fragment_setting}
													onChange={(value) =>
														onChange(host.uid, "fragment_setting", value)
													}
												/>
												<NoisePatternFields
													value={host.data.noise_setting}
													onChange={(value) =>
														onChange(host.uid, "noise_setting", value)
													}
												/>
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
									)}
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
						<DeleteConfirmDialog
							description={t("hostsPage.deleteConfirmation")}
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
						</DeleteConfirmDialog>
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
	nodes?: NodeType[];
};

const CreateHostModal: FC<CreateHostModalProps> = ({
	isOpen,
	onClose,
	inboundOptions,
	onSubmit,
	isSubmitting,
	nodes,
}) => {
	const { t } = useTranslation();
	const initialRef = useRef<HTMLInputElement | null>(null);
	const [formState, setFormState] = useState<CreateHostValues>({
		inboundTag: inboundOptions[0]?.value ?? "",
		remark: "",
		address: "",
		dns_primary: "1.1.1.1",
		dns_secondary: "8.8.8.8",
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
	const nodeAddressOptions = useMemo(
		() => getNodeAddressOptions(nodes),
		[nodes],
	);
	const selectedInbound = useMemo(
		() =>
			inboundOptions.find((option) => option.value === formState.inboundTag),
		[inboundOptions, formState.inboundTag],
	);
	const isVirtualTunnelInbound =
		selectedInbound?.protocol === "openvpn" ||
		selectedInbound?.protocol === "l2tp";
	const isWireGuardInbound = selectedInbound?.protocol === "wireguard";

	useEffect(() => {
		if (isOpen) {
			setFormState({
				inboundTag: inboundOptions[0]?.value ?? "",
				remark: "",
				address: "",
				dns_primary: "1.1.1.1",
				dns_secondary: "8.8.8.8",
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
				rotationTextToOptions(formState.address_options).length === 0) ||
			(isWireGuardInbound &&
				(!formState.dns_primary.trim() || !formState.dns_secondary.trim()))
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
						<FormControl isRequired>
							<FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
							<SearchableTagSelect
								value={formState.inboundTag}
								options={inboundOptions}
								placeholder={t("hostsPage.inboundLabel")}
								onChange={(value) =>
									setFormState((prev) => ({
										...prev,
										inboundTag: String(value),
									}))
								}
							/>
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
							<MultiValueAutocomplete
								value={formState.address}
								options={nodeAddressOptions}
								placeholder={t(
									"hostsDialog.addressPlaceholder",
									"Type an address or select node IPs",
								)}
								onChange={(value) =>
									setFormState((prev) => ({
										...prev,
										address: value,
									}))
								}
								rightElement={<DynamicTokensPopover />}
							/>
						</FormControl>
						{hasMultipleRotationValues(formState.address) && (
							<RotationControls
								mode={formState.address_selection_mode}
								ttl={formState.address_ttl_seconds}
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
						)}
						{isWireGuardInbound && (
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								<FormControl isRequired>
									<FormLabel>{t("hostsDialog.dnsPrimary")}</FormLabel>
									<Input
										value={formState.dns_primary}
										placeholder="1.1.1.1"
										onChange={(event) =>
											setFormState((prev) => ({
												...prev,
												dns_primary: event.target.value,
											}))
										}
									/>
								</FormControl>
								<FormControl isRequired>
									<FormLabel>{t("hostsDialog.dnsSecondary")}</FormLabel>
									<Input
										value={formState.dns_secondary}
										placeholder="8.8.8.8"
										onChange={(event) =>
											setFormState((prev) => ({
												...prev,
												dns_secondary: event.target.value,
											}))
										}
									/>
								</FormControl>
							</SimpleGrid>
						)}
						{!isVirtualTunnelInbound && (
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								<FormControl>
									<FormLabel>{t("hostsDialog.port")}</FormLabel>
									<NumericInput
										value={formState.port ?? ""}
										fieldProps={{
											placeholder: inboundPortPlaceholder(selectedInbound),
										}}
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
									<MultiValueAutocomplete
										value={formState.sni}
										placeholder={t(
											"hostsDialog.sniPlaceholder",
											"Type SNI values",
										)}
										onChange={(value) =>
											setFormState((prev) => ({
												...prev,
												sni: value,
											}))
										}
									/>
								</FormControl>
							</SimpleGrid>
						)}
						{!isVirtualTunnelInbound && (
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
						)}
						{!isVirtualTunnelInbound && (
							<FormControl>
								<FormLabel>{t("hostsDialog.host")}</FormLabel>
								<MultiValueAutocomplete
									value={formState.host}
									placeholder={t(
										"hostsDialog.hostPlaceholder",
										"Type request host values",
									)}
									onChange={(value) =>
										setFormState((prev) => ({
											...prev,
											host: value,
										}))
									}
									rightElement={<DynamicTokensPopover />}
								/>
							</FormControl>
						)}
						{!isVirtualTunnelInbound && (hasMultipleRotationValues(formState.sni) ||
							hasMultipleRotationValues(formState.host)) && (
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								{hasMultipleRotationValues(formState.sni) && (
									<RotationControls
										mode={formState.sni_selection_mode}
										ttl={formState.sni_ttl_seconds}
										onModeChange={(value) =>
											setFormState((prev) => ({
												...prev,
												sni_selection_mode: value,
											}))
										}
										onTTLChange={(value) =>
											setFormState((prev) => ({
												...prev,
												sni_ttl_seconds: value,
											}))
										}
									/>
								)}
								{hasMultipleRotationValues(formState.host) && (
									<RotationControls
										mode={formState.host_selection_mode}
										ttl={formState.host_ttl_seconds}
										onModeChange={(value) =>
											setFormState((prev) => ({
												...prev,
												host_selection_mode: value,
											}))
										}
										onTTLChange={(value) =>
											setFormState((prev) => ({
												...prev,
												host_ttl_seconds: value,
											}))
										}
									/>
								)}
							</SimpleGrid>
						)}
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
							!rotationTextToOptions(formState.address).length ||
							(isWireGuardInbound &&
								(!formState.dns_primary.trim() ||
									!formState.dns_secondary.trim()))
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
	const { data: nodes = [] } = useNodesQuery();
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
	const [selectedHostUids, setSelectedHostUids] = useState<string[]>([]);
	const [cloneHost, setCloneHost] = useState<HostState | null>(null);
	// Disabled hosts are hidden by default.
	const [includeDisabled, setIncludeDisabled] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [savingHostUid, setSavingHostUid] = useState<string | null>(null);
	const [deletingUid, setDeletingUid] = useState<string | null>(null);
	const [bulkAction, setBulkAction] = useState<
		"enable" | "disable" | "delete" | null
	>(null);

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

	useEffect(() => {
		fetchHosts();
	}, [fetchHosts]);

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

	useEffect(() => {
		const existing = new Set(_hostItemsState.map((host) => host.uid));
		setSelectedHostUids((current) =>
			current.filter((uid) => existing.has(uid)),
		);
	}, [_hostItemsState]);

	const inboundOptions: InboundOption[] = useMemo(() => {
		const options: InboundOption[] = [];
		inbounds.forEach((list) => {
			list.forEach((inbound) => {
				options.push({
					label: `${inbound.tag} (${inbound.protocol.toUpperCase()} - ${inbound.network})`,
					value: inbound.tag,
					protocol: inbound.protocol,
					network: inbound.network,
					port: inbound.port,
				});
			});
		});
		return options.sort((a, b) => a.label.localeCompare(b.label));
	}, [inbounds]);

	const activeHosts = useMemo(
		() => sortHosts(_hostItemsState.filter((host) => !host.data.is_disabled)),
		[_hostItemsState],
	);

	const allHosts = useMemo(() => sortHosts(_hostItemsState), [_hostItemsState]);

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
		if (
			showHostValidationError(validateHostState(host.inboundTag, host.data))
		) {
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

	const handleBulkToggleHosts = async (
		items: HostState[],
		isActive: boolean,
	) => {
		if (!items.length || isPostLoading || bulkAction) {
			return;
		}
		const selected = new Set(items.map((host) => host.uid));
		const affectedTags = new Set<string>();
		items.forEach((host) => {
			affectedTags.add(host.inboundTag);
			affectedTags.add(host.initialInboundTag);
		});
		const previousHosts = hostItemsRef.current;
		const nextHosts = sortHosts(
			previousHosts.map((host) =>
				selected.has(host.uid)
					? { ...host, data: { ...host.data, is_disabled: !isActive } }
					: host,
			),
		);
		applyHostItems(nextHosts);
		setBulkAction(isActive ? "enable" : "disable");
		try {
			const payload = buildInboundPayload(nextHosts, affectedTags);
			await setHosts(payload);
			await fetchHosts();
			setSelectedHostUids([]);
			toast({
				title: isActive
					? t("hostsPage.bulkEnabled", "Hosts enabled")
					: t("hostsPage.bulkDisabled", "Hosts disabled"),
				status: "success",
				isClosable: true,
				position: "top",
			});
		} catch (_error) {
			applyHostItems(previousHosts);
			toast({
				title: t("hostsPage.error.save"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setBulkAction(null);
		}
	};

	const handleBulkDeleteHosts = async (items: HostState[]) => {
		if (!items.length || isPostLoading || bulkAction) {
			return;
		}
		const selected = new Set(items.map((host) => host.uid));
		const affectedTags = new Set<string>();
		items.forEach((host) => {
			affectedTags.add(host.inboundTag);
			affectedTags.add(host.initialInboundTag);
		});
		const previousHosts = hostItemsRef.current;
		const nextHosts = previousHosts.filter((host) => !selected.has(host.uid));
		applyHostItems(nextHosts);
		setBulkAction("delete");
		try {
			const payload = buildInboundPayload(nextHosts, affectedTags);
			await setHosts(payload);
			await fetchHosts();
			setSelectedHostUids([]);
			toast({
				title: t("hostsPage.bulkDeleted", "Hosts deleted"),
				status: "success",
				isClosable: true,
				position: "top",
			});
		} catch (_error) {
			applyHostItems(previousHosts);
			toast({
				title: t("hostsPage.error.delete"),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setBulkAction(null);
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
					dns_primary: values.dns_primary,
					dns_secondary: values.dns_secondary,
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
					dns_primary: values.dns_primary,
					dns_secondary: values.dns_secondary,
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

	const hostSummaryItems = useMemo<ResourceSummaryItem[]>(() => {
		const total = allHosts.length;
		const disabled = allHosts.filter((host) => host.data.is_disabled).length;
		const enabled = total - disabled;
		const inboundCount = new Set(allHosts.map((host) => host.inboundTag)).size;
		return [
			{
				label: t("hostsPage.summary.total", "Total"),
				value: total,
				colorScheme: "gray",
			},
			{
				label: t("hostsPage.summary.enabled", "Enabled"),
				value: enabled,
				colorScheme: "green",
			},
			{
				label: t("hostsPage.summary.disabled", "Disabled"),
				value: disabled,
				colorScheme: "red",
			},
			{
				label: t("hostsPage.summary.inbounds", "Inbounds"),
				value: inboundCount,
				colorScheme: "purple",
			},
			{
				label: t("hostsPage.summary.filtered", "Filtered"),
				value: displayedHosts.length,
				colorScheme: "teal",
			},
		];
	}, [allHosts, displayedHosts.length, t]);

	const renderRotationValues = useCallback(
		(value: string, emptyLabel: string) => {
			const values = rotationTextToOptions(value);
			if (!values.length) {
				return <Text color="panel.textMuted">{emptyLabel}</Text>;
			}
			const visible = values.slice(0, 2);
			const hiddenCount = values.length - visible.length;
			return (
				<Tooltip
					label={values.join(", ")}
					isDisabled={values.length <= visible.length}
					hasArrow
					placement="top"
				>
					<HStack spacing={1} flexWrap="wrap" maxW="full">
						{visible.map((item) => (
							<Tag key={item} size="sm" maxW="120px">
								<Text as="span" noOfLines={1}>
									{item}
								</Text>
							</Tag>
						))}
						{hiddenCount > 0 && (
							<Tag size="sm" colorScheme="blue">
								+{hiddenCount}
							</Tag>
						)}
					</HStack>
				</Tooltip>
			);
		},
		[],
	);

	const hostColumns = useMemo<DataTableColumn<HostState>[]>(
		() => [
			{
				id: "remark",
				header: t("hostsPage.host", "Host"),
				isPrimary: true,
				priority: "primary",
				width: { base: "150px", lg: "160px", xl: "180px" },
				minWidth: "130px",
				maxWidth: "220px",
				mobilePriority: 0,
				mobileMetaLabel: t("hostsPage.host", "Host"),
				cell: (host) => {
					const dirty = isHostDirty(host);
					const hostName = host.data.remark || t("hostsPage.untitledHost");
					return (
						<Stack spacing={0.5} minW={0}>
							<Tooltip label={hostName} isDisabled={hostName.length <= 24}>
								<Text fontWeight="semibold" noOfLines={1}>
									{hostName}
								</Text>
							</Tooltip>
							<HStack spacing={1} flexWrap="wrap">
								{host.data.id != null && (
									<Text fontSize="xs" color="panel.textMuted">
										ID: {host.data.id}
									</Text>
								)}
								{dirty && (
									<Tag size="sm" colorScheme="orange">
										{t("hostsPage.unsaved")}
									</Tag>
								)}
							</HStack>
						</Stack>
					);
				},
			},
			{
				id: "address",
				header: t("hostsDialog.address", "Address"),
				priority: "high",
				width: { base: "210px", lg: "240px", xl: "280px" },
				minWidth: "170px",
				maxWidth: "320px",
				mobilePriority: 1,
				mobileMetaLabel: t("hostsDialog.address", "Address"),
				cell: (host) =>
					renderRotationValues(host.data.address, t("hostsPage.noAddress")),
			},
			{
				id: "port",
				header: t("hostsDialog.port", "Port"),
				priority: "high",
				width: "72px",
				minWidth: "64px",
				maxWidth: "82px",
				mobilePriority: 2,
				mobileMetaLabel: t("hostsDialog.port", "Port"),
				cell: (host) =>
					host.data.port != null ? (
						<Text fontWeight="semibold" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
							{host.data.port}
						</Text>
					) : (
						<Text color="panel.textMuted">-</Text>
					),
			},
			{
				id: "inbound",
				header: t("hostsPage.inboundLabel", "Inbound"),
				priority: "high",
				width: { base: "150px", lg: "160px", xl: "190px" },
				minWidth: "130px",
				maxWidth: "230px",
				mobilePriority: 3,
				mobileMetaLabel: t("hostsPage.inboundLabel", "Inbound"),
				cell: (host) => {
					const inbound = inboundOptions.find(
						(option) => option.value === host.inboundTag,
					);
					return (
						<Stack spacing={0.5} minW={0}>
							<Text fontWeight="semibold" noOfLines={1}>
								{host.inboundTag}
							</Text>
							<Text fontSize="xs" color="panel.textMuted" noOfLines={1}>
								{inbound
									? `${inbound.protocol.toUpperCase()} / ${inbound.network}`
									: t("hostsPage.unknownInbound", "Unknown inbound")}
							</Text>
						</Stack>
					);
				},
			},
			{
				id: "sni",
				header: t("hostsDialog.sni", "SNI"),
				priority: "low",
				hideBelow: "xl",
				width: "180px",
				minWidth: "140px",
				maxWidth: "220px",
				mobilePriority: 4,
				mobileMetaLabel: t("hostsDialog.sni", "SNI"),
				cell: (host) => renderRotationValues(host.data.sni, "-"),
			},
			{
				id: "request_host",
				header: t("hostsDialog.host", "Request host"),
				priority: "low",
				hideBelow: "xl",
				width: "180px",
				minWidth: "140px",
				maxWidth: "220px",
				mobilePriority: 5,
				mobileMetaLabel: t("hostsDialog.host", "Request host"),
				cell: (host) => renderRotationValues(host.data.host, "-"),
			},
			{
				id: "security",
				header: t("hostsDialog.security", "Security"),
				priority: "low",
				hideBelow: "xl",
				width: "130px",
				maxWidth: "150px",
				mobilePriority: 6,
				mobileMetaLabel: t("hostsDialog.security", "Security"),
				cell: (host) => (
					<Tag size="sm" colorScheme="blue">
						{host.data.security || "inbound_default"}
					</Tag>
				),
			},
		],
		[inboundOptions, renderRotationValues, t],
	);

	const hostRowActions = (
		host: HostState,
	): DataTableRowAction<HostState>[] => {
			const isActive = !host.data.is_disabled;
			return [
				{
					id: "edit",
					label: t("hostsPage.edit", "Edit"),
					icon: <EditIcon />,
					onClick: () => setSelectedHostUid(host.uid),
				},
				{
					id: "toggle",
					label: isActive
						? t("hostsPage.disable", "Disable")
						: t("hostsPage.enable", "Enable"),
					icon: isActive ? (
						<XCircleIcon width={16} />
					) : (
						<CheckCircleIcon width={16} />
					),
					onClick: () => toggleActive(host.uid, !isActive),
					isDisabled: isPostLoading,
				},
				{
					id: "delete",
					label: t("hostsPage.delete", "Delete"),
					icon: <TrashIcon width={16} />,
					isDanger: true,
					render: (_row, onMenuClose) => (
						<DeleteConfirmDialog
							description={t("hostsPage.deleteConfirmation")}
							isLoading={deletingUid === host.uid && isPostLoading}
							onConfirm={async () => {
								await handleDeleteHost(host.uid);
								onMenuClose();
							}}
						>
							<MenuItem
								icon={<TrashIcon width={16} />}
								color="red.400"
								isDisabled={isPostLoading}
								onClick={(event) => event.stopPropagation()}
							>
								{t("hostsPage.delete", "Delete")}
							</MenuItem>
						</DeleteConfirmDialog>
					),
				},
			];
	};

	return (
		<VStack align="stretch" spacing={4}>
			<ResourceListCard
				title={t("hostsPage.listHeader", "Host list")}
				summaryItems={hostSummaryItems}
				actions={
					<Button
						colorScheme="primary"
						size="sm"
						onClick={() => setCreateOpen(true)}
						leftIcon={<AddIcon />}
						isDisabled={!inboundOptions.length}
						h="36px"
						px={3}
						borderRadius="4px"
					>
						{t("hostsPage.addHost")}
					</Button>
				}
				footerActions={
					<ResourceRefreshButton
						aria-label={t("hostsPage.refresh", "Refresh hosts")}
						label={t("hostsPage.refresh", "Refresh hosts")}
						icon={<ArrowPathIcon width={16} />}
						isLoading={isRefreshing}
						onClick={fetchHosts}
					/>
				}
			>
				<Stack
					direction={{ base: "column", sm: "row" }}
					spacing={2}
					align={{ base: "stretch", sm: "center" }}
					flexWrap="wrap"
				>
					<Input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder={t("hostsPage.searchPlaceholder")}
						size="sm"
						w={{ base: "full", md: "280px" }}
					/>
					<Checkbox
						isChecked={includeDisabled}
						onChange={(event) => setIncludeDisabled(event.target.checked)}
					>
						{t("hostsPage.showDisabled")}
					</Checkbox>
				</Stack>
			</ResourceListCard>

			<DataTable
				ariaLabel={t("hostsPage.tabHosts", "Hosts")}
				data={displayedHosts}
				columns={hostColumns}
				getRowId={(host) => host.uid}
				isLoading={isInitialLoading}
				loadingRows={5}
				emptyState={
					<Box textAlign="center" color="panel.textMuted">
						{showSearchEmptyState
							? t("hostsPage.searchEmpty")
							: t("hostsPage.emptyState")}
					</Box>
				}
				rowActions={hostRowActions}
				actionsDisplay="menu"
				actionsPlacement="end"
				actionsColumnWidth="60px"
				showActionsOnHover
				enableSelection
				selectedRowIds={selectedHostUids}
				selectedCount={selectedHostUids.length}
				onSelectionChange={(rowIds) => setSelectedHostUids(rowIds)}
				selectedLabel={t("hostsPage.selectedCount", {
					defaultValue: "{{count}} hosts selected",
					count: selectedHostUids.length,
				})}
				renderBulkActions={(selectedRows) => {
					const enableTargets = selectedRows.filter(
						(host) => host.data.is_disabled,
					);
					const disableTargets = selectedRows.filter(
						(host) => !host.data.is_disabled,
					);
					return (
						<>
							<Button
								size="sm"
								variant="outline"
								leftIcon={<CheckCircleIcon width={16} />}
								isLoading={bulkAction === "enable"}
								isDisabled={
									Boolean(bulkAction) ||
									isPostLoading ||
									enableTargets.length === 0
								}
								onClick={() => handleBulkToggleHosts(enableTargets, true)}
							>
								{t("hostsPage.enable", "Enable")}
							</Button>
							<Button
								size="sm"
								variant="outline"
								leftIcon={<XCircleIcon width={16} />}
								isLoading={bulkAction === "disable"}
								isDisabled={
									Boolean(bulkAction) ||
									isPostLoading ||
									disableTargets.length === 0
								}
								onClick={() => handleBulkToggleHosts(disableTargets, false)}
							>
								{t("hostsPage.disable", "Disable")}
							</Button>
							<DeleteConfirmDialog
								description={t(
									"hostsPage.confirmBulkDelete",
									"Delete {{count}} selected host(s)?",
									{ count: selectedRows.length },
								)}
								isLoading={bulkAction === "delete"}
								isDisabled={selectedRows.length === 0}
								onConfirm={() => handleBulkDeleteHosts(selectedRows)}
							>
								<Button
									size="sm"
									variant="outline"
									colorScheme="red"
									leftIcon={<TrashIcon width={16} />}
									isLoading={bulkAction === "delete"}
									isDisabled={
										Boolean(bulkAction) ||
										isPostLoading ||
										selectedRows.length === 0
									}
								>
									{t("hostsPage.delete", "Delete")}
								</Button>
							</DeleteConfirmDialog>
						</>
					);
				}}
				mobileBreakpoint="lg"
				tableProps={{
					w: "full",
					sx: {
						tableLayout: "fixed",
						"& th, & td": {
							px: { base: 2, xl: 2.5 },
							py: 2.5,
							verticalAlign: "middle",
						},
					},
				}}
			/>

			<CreateHostModal
				isOpen={createOpen}
				onClose={() => setCreateOpen(false)}
				inboundOptions={inboundOptions}
				onSubmit={handleCreateHost}
				isSubmitting={savingHostUid === "create" && isPostLoading}
				nodes={nodes}
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
				nodes={nodes}
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
				nodes={nodes}
			/>
		</VStack>
	);
};

export default HostsManager;
