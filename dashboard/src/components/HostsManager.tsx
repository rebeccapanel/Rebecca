import { TagChips } from "components/labels/TagChips";
import { TagFilterButton } from "components/labels/TagFilterButton";
import {
	EMPTY_LABEL_FILTER,
	type LabelFilterValue,
	matchesTagFilter,
} from "components/labels/LabelFilter";
import { useInvalidateLabels, useTags } from "service/labels";
import { TagsSelect } from "components/labels/TagsSelect";
import { Field, FieldLabel } from "components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Badge } from "components/ui/badge";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Spinner } from "components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Checkbox } from "components/ui/checkbox";
import { toast } from "components/ui/sonner";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import type { SortingState } from "@tanstack/react-table";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";

import { FieldHint } from "components/ui/field-hint";
import { FormField } from "components/ui/form-field";
import { OverviewBand } from "components/ui/overview-band";
import { SegmentedControl } from "components/ui/segmented-control";
import { tlsAlpnOptions } from "utils/inbounds";
import { Input as UiInput } from "components/ui/input";
import { Badge as UiBadge } from "components/ui/badge";
import { Switch as UiSwitch } from "components/ui/switch";
import { buttonVariants } from "components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { hostEntityPage } from "components/entityPage/EntityOverviews";
import type { EntityPageInfo } from "components/entityPage/EntityPageParts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { ChevronDown, Network, RefreshCw, CircleCheck, Info, Pencil, Plus, Trash2, CircleX } from "lucide-react";

import { cn } from "lib/cn";
import {
	proxyFingerprint,
	proxyHostSecurity,
} from "constants/Proxies";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type HostsSchema, useHosts } from "contexts/HostsContext";
import { type NodeType, useNodesQuery } from "contexts/NodesContext";
import {
	type FC,
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { EntityNotePanel } from "components/EntityNotePanel";
import { fetch as apiFetch } from "service/http";
import {
	cloneFinalMask,
	type FinalMaskObject,
	finalMaskValidationError,
	getFinalMaskCapabilities,
	hostFinalMaskValue,
	isFinalMaskObject,
	sanitizeFinalMask,
} from "utils/finalmask";
import { getHostFormFields } from "utils/hostFormFields";
import { hostClientSettingsError, parseHostClientSettings } from "utils/hostClientSettings";
import { HostClientSettingsEditor } from "./HostClientSettingsEditor";
import {
	DEFAULT_SEARCH_MATCH_OPTIONS,
	matchesAnySearch,
} from "utils/searchMatch";
import { generateErrorMessage } from "utils/toastHandler";
import { AppleEmojiText } from "./common/AppleEmojiText";
import { EmojiShortcodeInput } from "./common/EmojiShortcodeInput";
import { DeleteIcon } from "./common/DeleteIcon";
import {
	MultiValueAutocomplete,
	type MultiValueAutocompleteOption,
} from "./common/MultiValueAutocomplete";
import { NumericInput } from "./common/NumericInput";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import { SearchInput } from "./common/SearchInput";
import { ConfirmDialog, DeleteConfirmDialog } from "./dialogs/ConfirmDialog";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
	ResourceRefreshButton,
} from "./ui";

const FinalMaskEditor = lazy(async () => ({
	default: (await import("./FinalMaskEditor")).FinalMaskEditor,
}));
const JsonEditor = lazy(async () => ({
	default: (await import("./JsonEditor")).JsonEditor,
}));

type HostData = {
	id: number | null;
	tags: string[];
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
	finalmask: FinalMaskObject | null;
	client_settings: string;
	random_user_agent: boolean;
	security: string;
	alpn: string;
	fingerprint: string;
	verify_peer_cert_by_name: string;
	pinned_peer_cert_sha256: string;
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
	if (key === "finalmask") {
		return (
			isFinalMaskObject(value)
				? cloneFinalMask(value)
				: value === null
					? null
					: currentData.finalmask
		) as HostData[Key];
	}
	if (key === "client_settings") {
		return (typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)) as HostData[Key];
	}
	return (value ?? "") as HostData[Key];
};

const EMPTY_HOST_DATA: HostData = {
	id: null,
	tags: [],
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
	finalmask: null,
	client_settings: "{}",
	random_user_agent: false,
	security: "inbound_default",
	alpn: "",
	fingerprint: "",
	verify_peer_cert_by_name: "",
	pinned_peer_cert_sha256: "",
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
	headerType?: string;
	alpn?: string;
	tls?: string;
	flow?: string;
	proxyNetwork?: string;
	port?: number;
	validationError?: string;
};

const profileHostNameError = (protocol: string | undefined, value: string) => {
	const name = value.trim();
	if (!name) return null;
	if (protocol === "wireguard") {
		if (name.length > 15) return "hostsPage.profileName.wireguardLength";
		if (!/^[A-Za-z0-9_]+$/.test(name)) {
			return "hostsPage.profileName.wireguardCharacters";
		}
	}
	if (protocol === "openvpn" && !/^[A-Za-z0-9._-]+$/.test(name)) {
		return "hostsPage.profileName.openvpnCharacters";
	}
	return null;
};

type CreateHostValues = HostData & {
	inboundTag: string;
};

const emptyCreateHostValues = (inboundTag: string): CreateHostValues => ({
	...EMPTY_HOST_DATA,
	inboundTag,
});

const EditIcon = withClass(Pencil, "w-4 h-4");

const AddIcon = withClass(Plus, "w-4 h-4");

const InfoIcon = withClass(Info, "w-4 h-4 text-gray-400 cursor-pointer");

const DYNAMIC_TOKENS: Array<{ token: string; labelKey: string }> = [
	{ token: "{SERVER_IP}", labelKey: "hostsDialog.currentServer" },
	{ token: "{SERVER_IPV6}", labelKey: "hostsDialog.currentServerv6" },
	{ token: "{USERNAME}", labelKey: "hostsDialog.username" },
	{ token: "{user_id}", labelKey: "hostsDialog.userId" },
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
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
			<Field>
				<FieldLabel className="text-[0.75rem] text-gray-500 mb-1">
					{t("hostsDialog.rotationMode")}
				</FieldLabel>
				<SearchableTagSelect
					size="sm"
					value={mode}
					options={[
						{
							value: "random",
							label: t("inbounds.randomPort"),
						},
						{ value: "ttl", label: t("hostsDialog.rotationTTL") },
					]}
					placeholder={t("hostsDialog.rotationMode")}
					onChange={(value) => onModeChange(String(value))}
				/>
			</Field>
			<Field>
				<FieldLabel className="text-[0.75rem] text-gray-500 mb-1">
					{t("hostsDialog.rotationTTLSeconds")}
				</FieldLabel>
				<NumericInput size="sm" value={ttl ?? ""} min={1} max={2592000} fieldProps={{ className: "[placeholder:120]" }} disabled={mode !== "ttl"} onChange={(_, num) => onTTLChange(Number.isNaN(num) ? null : num)} />
			</Field>
		</div>
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

const inboundPortPlaceholder = (inbound?: InboundOption) =>
	inbound?.port ? `Inbound default: ${inbound.port}` : "Inherited from inbound";

const inheritedHostValue = (value: string, fallback?: string) =>
	["", "none", "default", "inbound_default", "inbound-default"].includes(
		value.trim().toLowerCase(),
	)
		? fallback
		: value;

const finalMaskCapabilitiesForHost = (
	data: HostData,
	inbound?: InboundOption,
) =>
	getFinalMaskCapabilities({
		protocol: inbound?.protocol,
		network: inbound?.network,
		alpn: inheritedHostValue(data.alpn, inbound?.alpn),
		security: inheritedHostValue(data.security, inbound?.tls),
		flow: inbound?.flow,
		proxyNetwork: inbound?.proxyNetwork,
	});

const fitHostToInbound = (
	data: HostData,
	inbound?: InboundOption,
): HostData => {
	const capabilities = finalMaskCapabilitiesForHost(data, inbound);
	return {
		...data,
		finalmask: sanitizeFinalMask(data.finalmask, capabilities),
		mux_enable: capabilities.mux && data.mux_enable,
	};
};

const DynamicTokensPopover: FC = () => {
	const { t } = useTranslation();

	return (
		<Popover>
			<PopoverTrigger asChild>
				<div className="-mt-1">
					<InfoIcon />
				</div>
			</PopoverTrigger>
			
				<PopoverContent
					collisionPadding={12}
					className="max-h-[var(--radix-popover-content-available-height)] max-w-[20rem] overflow-y-auto text-[0.75rem]"
				>
					
					
					<div className="p-3">
						<div className="pe-5 leading-[1.4]">
							<p className="mb-2">{t("hostsDialog.desc")}</p>
							{DYNAMIC_TOKENS.map(({ token, labelKey }) => (
								<p key={token} className="mt-1">
									<Badge className="me-2">{token}</Badge>
									<AppleEmojiText>{t(labelKey)}</AppleEmojiText>
								</p>
							))}
						</div>
					</div>
				</PopoverContent>
			
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

const certificatePinsValid = (value: string) =>
	!value.trim() ||
	value
		.split(",")
		.every((pin) => /^[0-9a-f]{64}$/i.test(pin.trim().replaceAll(":", "")));

const CertificateFingerprintField: FC<{
	data: Pick<HostData, "address" | "sni" | "host" | "verify_peer_cert_by_name">;
	port: number;
	value: string;
	onChange: (value: string) => void;
}> = ({ data, port, value, onChange }) => {
	const { t } = useTranslation();
	
	const [isGenerating, setIsGenerating] = useState(false);
	const address = rotationTextToOptions(data.address)[0] ?? "";
	const serverName =
		rotationTextToOptions(data.sni)[0] ??
		rotationTextToOptions(data.host)[0] ??
		rotationTextToOptions(data.verify_peer_cert_by_name)[0] ??
		address;

	const generate = async () => {
		setIsGenerating(true);
		try {
			const result = await apiFetch<{ fingerprint: string }>(
				"/hosts/certificate-fingerprint",
				{
					method: "POST",
					body: { address, port, server_name: serverName },
				},
			);
			onChange(result.fingerprint);
			toast.success(t("hostsDialog.certificateFingerprintGenerated"));
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<Field data-invalid={!certificatePinsValid(value)}>
			<FieldLabel>{t("hostsDialog.pinnedPeerCertSha256")}</FieldLabel>
			<div className="flex flex-row items-stretch gap-2">
				<Input dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0!" />
				<Button disabled={!address} onClick={generate} variant="outline" size="sm" loading={isGenerating} className="shrink-0 self-center">{<RefreshCw className="w-[14px]" />}
					{t("hostsDialog.generateCertificateFingerprint")}
				</Button>
			</div>
		</Field>
	);
};

const normalizeHostData = (host: HostsSchema[string][number]): HostData => ({
	id: host.id ?? null,
	tags: host.tags ?? [],
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
	fragment_setting: "",
	noise_setting: "",
	finalmask: hostFinalMaskValue(
		host.finalmask,
		normalizeString(host.fragment_setting),
		normalizeString(host.noise_setting),
	),
	client_settings: JSON.stringify(host.client_settings ?? {}, null, 2),
	random_user_agent: normalizeBoolean(host.random_user_agent),
	security: host.security ?? "inbound_default",
	alpn: host.alpn ?? "",
	fingerprint: host.fingerprint ?? "",
	verify_peer_cert_by_name: host.verify_peer_cert_by_name ?? "",
	pinned_peer_cert_sha256: host.pinned_peer_cert_sha256 ?? "",
	use_sni_as_host: normalizeBoolean(host.use_sni_as_host),
});

const cloneHostData = (data: HostData): HostData => ({
	id: data.id ?? null,
	tags: [...(data.tags ?? [])],
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
	finalmask: cloneFinalMask(data.finalmask),
	client_settings: data.client_settings,
	random_user_agent: data.random_user_agent,
	security: data.security,
	alpn: data.alpn,
	fingerprint: data.fingerprint,
	verify_peer_cert_by_name: data.verify_peer_cert_by_name,
	pinned_peer_cert_sha256: data.pinned_peer_cert_sha256,
	use_sni_as_host: data.use_sni_as_host,
});

const serializeHostData = (data: HostData) => ({
	...data,
	client_settings: hostClientSettingsError(data.client_settings) ? data.client_settings : parseHostClientSettings(data.client_settings),
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
	fragment_setting: "",
	noise_setting: "",
	finalmask: data.finalmask,
});

const validateHostState = (
	inboundTag: string,
	data: HostData | CreateHostValues,
	inbound?: InboundOption,
): string[] => {
	const errors: string[] = [];
	if (!inboundTag.trim()) {
		errors.push("Inbound is required.");
	}
	if (!data.remark.trim()) {
		errors.push("Remark is required.");
	}
	const profileNameError = profileHostNameError(inbound?.protocol, data.remark);
	if (profileNameError) {
		errors.push(profileNameError);
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
	if (!certificatePinsValid(data.pinned_peer_cert_sha256)) {
		errors.push(
			"Certificate pins must be comma-separated SHA-256 fingerprints.",
		);
	}
	const clientSettingsError = hostClientSettingsError(data.client_settings);
	if (clientSettingsError) errors.push(clientSettingsError);
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
	const finalMaskError = finalMaskValidationError(
		fitHostToInbound(data, inbound).finalmask,
	);
	if (finalMaskError) {
		errors.push(finalMaskError);
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

const formatHostForApi = (
	rawData: HostData,
	inbound?: InboundOption,
	fitToInbound = true,
): HostsSchema[string][number] => {
	const data = fitToInbound ? fitHostToInbound(rawData, inbound) : rawData;
	return {
		id: data.id ?? null,
		tags: data.tags ?? [],
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
		fragment_setting: null,
		noise_setting: null,
		finalmask: cloneFinalMask(data.finalmask),
		client_settings: parseHostClientSettings(data.client_settings),
		random_user_agent: data.random_user_agent,
		security: data.security || "inbound_default",
		alpn: data.alpn || "",
		fingerprint: data.fingerprint || "",
		verify_peer_cert_by_name: data.verify_peer_cert_by_name.trim(),
		pinned_peer_cert_sha256: data.pinned_peer_cert_sha256.trim(),
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

const groupHostsByInbound = (
	items: HostState[],
	inboundOptions: InboundOption[],
	fitHostUid?: string,
): HostsSchema => {
	const grouped = new Map<string, HostState[]>();
	items.forEach((host) => {
		const list = grouped.get(host.inboundTag) ?? [];
		list.push(host);
		grouped.set(host.inboundTag, list);
	});
	const result: HostsSchema = {};
	grouped.forEach((value, key) => {
		result[key] = value.map((host) =>
			formatHostForApi(
				host.data,
				inboundOptions.find((option) => option.value === host.inboundTag),
				host.uid === fitHostUid,
			),
		);
	});
	return result;
};

const buildInboundPayload = (
	items: HostState[],
	inboundTags: Iterable<string>,
	inboundOptions: InboundOption[],
	fitHostUid?: string,
): Partial<HostsSchema> => {
	const grouped = groupHostsByInbound(items, inboundOptions, fitHostUid);
	const uniqueTags = Array.from(new Set(inboundTags));
	const payload: Partial<HostsSchema> = {};
	uniqueTags.forEach((tag) => {
		payload[tag] = grouped[tag] ?? [];
	});
	return payload;
};

const HostFormSection: FC<{
	title: string;
	description: string;
	badge?: string;
	children: ReactNode;
}> = ({ title, description, badge, children }) => (
	<section className="flex flex-col gap-4 rounded-lg border p-4">
		<div className="flex flex-wrap items-center gap-2">
			<h3 className="text-sm font-semibold">{title}</h3>
			{badge ? <UiBadge variant="outline">{badge}</UiBadge> : null}
			<FieldHint>{description}</FieldHint>
		</div>
		{children}
	</section>
);

const HostAdvancedSection: FC<{
	title: string;
	description: string;
	badge?: string;
	children: ReactNode;
}> = ({ title, description, badge, children }) => {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
			<div className="flex items-center justify-between gap-3 px-4 py-3">
				<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-start">
					<ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
					<span className="text-sm font-semibold">{title}</span>
					{badge ? <UiBadge variant="outline">{badge}</UiBadge> : null}
				</CollapsibleTrigger>
				<FieldHint>{description}</FieldHint>
			</div>
			<CollapsibleContent className="flex flex-col gap-5 border-t px-4 py-4">{children}</CollapsibleContent>
		</Collapsible>
	);
};

const HostToggle: FC<{
	label: string;
	description: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	danger?: boolean;
}> = ({ label, description, checked: isChecked, onChange, danger = false }) => (
	<div className={cn("flex items-center justify-between gap-4 rounded-lg border px-4 py-3", danger && isChecked && "border-orange-400")}>
		<div className="flex min-w-0 items-center gap-1.5">
			<span className="text-sm font-medium">{label}</span>
			<FieldHint>{description}</FieldHint>
		</div>
		<UiSwitch aria-label={label} checked={isChecked} onCheckedChange={onChange} className="shrink-0" />
	</div>
);

const HOST_DIALOG_CONTENT_CLASS =
	"flex max-h-[min(780px,calc(100dvh-10rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:w-auto max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

type HostDialogShellProps = {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	subtitle?: string;
	initialFocusRef?: RefObject<HTMLInputElement | null>;
	form: ReactNode;
	json: ReactNode;
	footer: ReactNode;
	page?: EntityPageInfo;
};

const HostDialogShell: FC<HostDialogShellProps> = ({
	open: isOpen,
	onClose,
	title,
	subtitle,
	initialFocusRef,
	form,
	json,
	footer,
	page,
}) => {
	const { t } = useTranslation();
	const [tab, setTab] = useState("form");
	return (
		<Dialog
			section="hosts"
			page={page}
			open={isOpen}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				className={HOST_DIALOG_CONTENT_CLASS}
				onOpenAutoFocus={(event) => {
					if (initialFocusRef?.current) {
						event.preventDefault();
						initialFocusRef.current.focus();
					}
				}}
			>
				<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
					<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
						<Network className="size-4" />
					</div>
					<div className="min-w-0">
						<DialogTitle className="truncate text-base">{title}</DialogTitle>
						{subtitle ? <DialogDescription className="truncate">{subtitle}</DialogDescription> : null}
					</div>
				</DialogHeader>
				<Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
					<div className="border-b px-5 pt-2.5 pb-2.5">
						<TabsList className="w-full">
							<TabsTrigger value="form">{t("form")}</TabsTrigger>
							<TabsTrigger value="json">{t("json")}</TabsTrigger>
						</TabsList>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<TabsContent value="form" className="mt-0">
							{form}
						</TabsContent>
						<TabsContent value="json" className="mt-0">
							{json}
						</TabsContent>
					</div>
				</Tabs>
				<DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
					{footer}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};type HostFormProps = {
	data: HostData;
	inboundTag: string;
	inboundOptions: InboundOption[];
	nodes?: NodeType[];
	initialFocusRef?: RefObject<HTMLInputElement | null>;
	onChange: <Key extends keyof HostData>(
		key: Key,
		value: HostData[Key],
	) => void;
	onChangeInbound: (value: string) => void;
};

const HostForm: FC<HostFormProps> = ({
	data,
	inboundTag,
	inboundOptions,
	nodes,
	initialFocusRef,
	onChange,
	onChangeInbound,
}) => {
	const { t } = useTranslation();
	const selectedInbound = useMemo(
		() => inboundOptions.find((option) => option.value === inboundTag),
		[inboundOptions, inboundTag],
	);
	const nodeAddressOptions = useMemo(
		() => getNodeAddressOptions(nodes),
		[nodes],
	);
	const isWireGuardInbound = selectedInbound?.protocol === "wireguard";
	const isProfileHostInbound =
		isWireGuardInbound || selectedInbound?.protocol === "openvpn";
	const isVirtualTunnelInbound = [
		"openvpn",
		"l2tp",
		"pptp",
		"ikev2",
		"anyconnect",
	].includes(selectedInbound?.protocol ?? "");
	const remarkError = profileHostNameError(
		selectedInbound?.protocol,
		data.remark,
	);
	const capabilities = finalMaskCapabilitiesForHost(data, selectedInbound);
	const sanitizedFinalMask = sanitizeFinalMask(data.finalmask, capabilities);
	const finalMaskError = finalMaskValidationError(sanitizedFinalMask);
	const maskCount =
		(sanitizedFinalMask?.tcp?.length ?? 0) +
		(sanitizedFinalMask?.udp?.length ?? 0) +
		(sanitizedFinalMask?.quicParams ? 1 : 0);
	const effectiveSecurity =
		inheritedHostValue(data.security, selectedInbound?.tls)
			?.trim()
			.toLowerCase() ?? "";
	const { data: knownHostTags = [] } = useTags("host");
	const {
		showsRequestHost,
		showsRequestPath,
		showsSNI,
		showsALPN,
		showsFingerprint,
		showsCertificateVerification,
		supportsStreamSecurity,
		usesTLS,
	} = getHostFormFields(
		selectedInbound?.network,
		effectiveSecurity,
		selectedInbound?.headerType,
		selectedInbound?.protocol,
	);
	const hasAdvancedSettings =
		usesTLS || capabilities.supported || capabilities.mux || showsRequestHost;
	const transport = selectedInbound?.network.trim().toLowerCase() ?? "";
	const requestHostLabel =
		transport === "grpc"
			? t("inbounds.grpc.authority")
			: transport === "quic"
				? t("inbounds.quic.security")
				: t("hostsDialog.host");
	const requestPathLabel =
		transport === "grpc"
			? t("serviceName")
			: transport === "kcp"
				? t("inbounds.kcp.seed")
				: transport === "quic"
					? t("inbounds.quic.key")
					: t("hostsDialog.path");
	const requestPathPlaceholder = ["grpc", "kcp"].includes(transport)
		? ""
		: transport === "quic"
			? "none"
			: "/";

	return (
		<div className="flex flex-col gap-5">
			<HostFormSection
				title={t("hostsPage.section.connection")}
				description={t("hostsPage.section.connectionDescription")}
				badge={t("hostsPage.required")}
			>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<FormField label={t("hostsPage.inboundLabel")} description={t("hostsPage.inboundHint")}>
						<SearchableTagSelect
							value={inboundTag}
							options={inboundOptions}
							placeholder={t("hostsPage.inboundLabel")}
							onChange={(value) => onChangeInbound(String(value))}
						/>
					</FormField>
					<FormField
						label={t("hostsDialog.remark")}
						description={t("hostsPage.remarkHint")}
						error={remarkError ? t(remarkError) : undefined}
					>
						<div className="relative">
							<EmojiShortcodeInput
								ref={initialFocusRef}
								value={data.remark}
								maxLength={isWireGuardInbound ? 15 : undefined}
								placeholder={t("hostsPage.remarkPlaceholder")}
								aria-invalid={Boolean(remarkError) || undefined}
								className={cn(!isProfileHostInbound && "pe-10")}
								enabled={!isProfileHostInbound}
								onChange={(value) => onChange("remark", value)}
							/>
							{!isProfileHostInbound ? (
								<div className="absolute inset-y-0 end-1.5 flex items-center">
									<DynamicTokensPopover />
								</div>
							) : null}
						</div>
					</FormField>
					<FormField label={t("tags.title")} className="md:col-span-2">
						<TagsSelect
							value={data.tags ?? []}
							onChange={(next) => onChange("tags", next)}
							options={knownHostTags.map((item) => item.tag)}
						/>
					</FormField>
					<FormField
						label={t("hostsDialog.address")}
						description={t("hostsPage.addressHint")}
						className={cn(isVirtualTunnelInbound && "md:col-span-2")}
					>
						<MultiValueAutocomplete
							value={data.address}
							options={nodeAddressOptions}
							placeholder={t("hostsDialog.addressPlaceholder")}
							onChange={(value) => onChange("address", value)}
							rightElement={<DynamicTokensPopover />}
						/>
					</FormField>
					{!isVirtualTunnelInbound ? (
						<FormField label={t("port")} description={t("hostsPage.portHint")}>
							<NumericInput
								value={data.port ?? ""}
								min={1}
								max={65535}
								fieldProps={{
									placeholder: inboundPortPlaceholder(selectedInbound),
								}}
								onChange={(_, num) => onChange("port", Number.isNaN(num) ? null : num)}
							/>
						</FormField>
					) : null}
				</div>

				{hasMultipleRotationValues(data.address) ? (
					<RotationControls
						mode={data.address_selection_mode}
						ttl={data.address_ttl_seconds}
						onModeChange={(value) => onChange("address_selection_mode", value)}
						onTTLChange={(value) => onChange("address_ttl_seconds", value)}
					/>
				) : null}

				{isWireGuardInbound ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<FormField label={t("hostsDialog.dnsPrimary")}>
							<UiInput value={data.dns_primary} placeholder="1.1.1.1" onChange={(event) => onChange("dns_primary", event.target.value)} />
						</FormField>
						<FormField label={t("hostsDialog.dnsSecondary")}>
							<UiInput value={data.dns_secondary} placeholder="8.8.8.8" onChange={(event) => onChange("dns_secondary", event.target.value)} />
						</FormField>
					</div>
				) : null}
			</HostFormSection>

			{supportsStreamSecurity ? (
				<HostFormSection
					title={t("hostsPage.section.security")}
					description={t("hostsPage.section.securityDescription")}
				>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<FormField label={t("hostsDialog.security")}>
	<SegmentedControl<string>
		label={t("hostsDialog.security")}
		value={data.security}
		options={proxyHostSecurity.map((option) => ({
			value: option.value,
			label: option.title,
		}))}
		onChange={(value) => onChange("security", value)}
	/>
</FormField>
						{showsSNI ? (
							<FormField label={t("hostsDialog.sni")}>
								<MultiValueAutocomplete
									value={data.sni}
									placeholder={t("hostsPage.inheritHint")}
									onChange={(value) => onChange("sni", value)}
								/>
							</FormField>
						) : null}
						{showsALPN ? (
							<FormField label={t("hostsDialog.alpn")}>
	<SearchableTagSelect
		mode="multiple"
		value={data.alpn ? data.alpn.split(",") : []}
		options={tlsAlpnOptions}
		placeholder={t("inbounds.tls.selectAlpn")}
		searchPlaceholder={t("inbounds.tls.searchAlpn")}
		onChange={(value) => onChange("alpn", [value].flat().filter(Boolean).join(","))}
	/>
</FormField>
						) : null}
						{showsFingerprint ? (
							<FormField label={t("hostsDialog.fingerprint")}>
								<SearchableTagSelect
									value={data.fingerprint}
									options={proxyFingerprint.map((option) => ({
										value: option.value,
										label: option.title,
									}))}
									placeholder={t("hostsDialog.fingerprint")}
									onChange={(value) => onChange("fingerprint", String(value))}
								/>
							</FormField>
						) : null}
						{showsCertificateVerification ? (
							<>
								<FormField label={t("hostsDialog.verifyPeerCertByName")}>
									<UiInput dir="ltr" value={data.verify_peer_cert_by_name} onChange={(event) => onChange("verify_peer_cert_by_name", event.target.value)} />
								</FormField>
								<CertificateFingerprintField
									data={data}
									port={data.port ?? selectedInbound?.port ?? 443}
									value={data.pinned_peer_cert_sha256}
									onChange={(value) => onChange("pinned_peer_cert_sha256", value)}
								/>
							</>
						) : null}
						{showsRequestHost ? (
							<FormField label={requestHostLabel}>
								<MultiValueAutocomplete
									value={data.host}
									placeholder={t("hostsPage.inheritHint")}
									onChange={(value) => onChange("host", value)}
									rightElement={<DynamicTokensPopover />}
								/>
							</FormField>
						) : null}
						{showsRequestPath ? (
							<FormField
								label={requestPathLabel}
								description={!["grpc", "kcp", "quic"].includes(transport) ? t("hostsPage.pathHint") : undefined}
							>
								<UiInput dir="ltr" value={data.path} placeholder={requestPathPlaceholder} onChange={(event) => onChange("path", event.target.value)} />
							</FormField>
						) : null}
					</div>

					{(showsSNI && hasMultipleRotationValues(data.sni)) || (showsRequestHost && hasMultipleRotationValues(data.host)) ? (
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							{showsSNI && hasMultipleRotationValues(data.sni) ? (
								<RotationControls
									mode={data.sni_selection_mode}
									ttl={data.sni_ttl_seconds}
									onModeChange={(value) => onChange("sni_selection_mode", value)}
									onTTLChange={(value) => onChange("sni_ttl_seconds", value)}
								/>
							) : null}
							{showsRequestHost && hasMultipleRotationValues(data.host) ? (
								<RotationControls
									mode={data.host_selection_mode}
									ttl={data.host_ttl_seconds}
									onModeChange={(value) => onChange("host_selection_mode", value)}
									onTTLChange={(value) => onChange("host_ttl_seconds", value)}
								/>
							) : null}
						</div>
					) : null}
				</HostFormSection>
			) : null}

			{!isVirtualTunnelInbound && hasAdvancedSettings ? (
				<HostAdvancedSection
					title={t("hostsPage.section.advanced")}
					description={t("hostsPage.section.advancedDescription")}
					badge={maskCount ? `${maskCount} ${t("hostsPage.configured")}` : t("hostsPage.optional")}
				>
					{capabilities.supported ? (
						<FormField
							label={t("hostsDialog.finalMask")}
							description={t("hostsPage.section.finalMaskDescription")}
							error={finalMaskError ?? undefined}
						>
							<Suspense fallback={<Spinner />}>
								<FinalMaskEditor
									value={sanitizedFinalMask}
									onChange={(value) => onChange("finalmask", value)}
									capabilities={capabilities}
								/>
							</Suspense>
						</FormField>
					) : null}

					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						{usesTLS ? (
							<HostToggle
								label={t("hostsDialog.allowinsecure")}
								description={t("hostsPage.allowInsecureHint")}
								checked={data.allowinsecure}
								danger
								onChange={(checked) => onChange("allowinsecure", checked)}
							/>
						) : null}
						{capabilities.mux ? (
							<HostToggle
								label={t("hostsDialog.muxEnable")}
								description={t("hostsPage.muxHint")}
								checked={data.mux_enable}
								onChange={(checked) => onChange("mux_enable", checked)}
							/>
						) : null}
						{showsRequestHost ? (
							<HostToggle
								label={t("hostsDialog.randomUserAgent")}
								description={t("hostsPage.randomUserAgentHint")}
								checked={data.random_user_agent}
								onChange={(checked) => onChange("random_user_agent", checked)}
							/>
						) : null}
						{showsSNI && showsRequestHost ? (
							<HostToggle
								label={t("hostsDialog.useSniAsHost")}
								description={t("hostsPage.useSniAsHostHint")}
								checked={data.use_sni_as_host}
								onChange={(checked) => onChange("use_sni_as_host", checked)}
							/>
						) : null}
					</div>
				</HostAdvancedSection>
			) : null}

			{supportsStreamSecurity ? (
				<HostAdvancedSection title={t("hostsDialog.clientSettings")} description={t("hostsDialog.clientSettingsHint")}>
					<HostClientSettingsEditor value={data.client_settings} onChange={(value) => onChange("client_settings", value)} usesTLS={usesTLS} protocol={selectedInbound?.protocol} network={selectedInbound?.network} />
				</HostAdvancedSection>
			) : null}
		</div>
	);
};

type HostDetailModalProps = {
	host: HostState | null;
	inboundOptions: InboundOption[];
	open: boolean;
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
	open: isOpen,
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
	const remarkError = profileHostNameError(
		selectedInbound?.protocol,
		host?.data.remark ?? "",
	);
	const finalMaskError = host
		? finalMaskValidationError(
				fitHostToInbound(host.data, selectedInbound).finalmask,
			)
		: null;
	const finalMaskValid = host ? finalMaskError === null : false;
	const canSubmit = host
		? Boolean(
				host.inboundTag &&
					host.data.remark.trim() &&
					!remarkError &&
					finalMaskValid &&
					!hostClientSettingsError(host.data.client_settings) &&
					(host.data.address.trim() ||
						rotationTextToOptions(host.data.address_options).length > 0) &&
					(!isWireGuardInbound ||
						(host.data.dns_primary.trim() && host.data.dns_secondary.trim())),
			)
		: false;
	const primaryDisabled =
		Boolean(jsonError) || (isCloneMode ? !canSubmit : !dirty || !canSubmit);
	const primaryLabel = isCloneMode ? t("hostsPage.clone.submit") : t("save");
	const hostPayload = useMemo(() => {
		if (!host) {
			return null;
		}
		return {
			inboundTag: host.inboundTag,
			...formatHostForApi(host.data, selectedInbound),
		};
	}, [host, selectedInbound]);
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
				const parsed: unknown = JSON.parse(value);
				if (!isFinalMaskObject(parsed)) {
					throw new Error("Invalid JSON payload");
				}
				const payload = parsed;
				if (
					Object.hasOwn(payload, "finalmask") &&
					payload.finalmask !== null &&
					!isFinalMaskObject(payload.finalmask)
				) {
					throw new Error(t("hostsPage.error.finalMaskObject"));
				}
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
		[host, onChange, onChangeInbound, t],
	);

	if (!host) {
		return null;
	}

	return (
		<HostDialogShell
			open={isOpen}
			onClose={onClose}
			page={!isCloneMode && host.data.id ? hostEntityPage(host.data, host.inboundTag) : undefined}
			title={<AppleEmojiText>{isCloneMode ? t("hostsPage.clone.title") : host.data.remark || t("hostsPage.untitledHost")}</AppleEmojiText>}
			subtitle={isCloneMode ? t("hostsPage.clone.description") : undefined}
			form={
				<div className="flex flex-col gap-5">
					<HostForm
						data={host.data}
						inboundTag={host.inboundTag}
						inboundOptions={inboundOptions}
						nodes={nodes}
						onChange={(key, value) => onChange(host.uid, key, value)}
						onChangeInbound={(value) => onChangeInbound(host.uid, value)}
					/>
					{!isCloneMode && host?.data.id ? <EntityNotePanel entityType="host" entityKey={host.data.id} /> : null}
				</div>
			}
			json={
				<div className="flex flex-col items-stretch gap-3">
					<Suspense fallback={<Spinner />}>
						<JsonEditor json={jsonText} onChange={handleJsonEditorChange} />
					</Suspense>
					{jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
				</div>
			}
			footer={
				<>
					{isCloneMode ? (
						<button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
							{t("hostsPage.cancel")}
						</button>
					) : (
						<DeleteConfirmDialog
							description={t("hostsPage.deleteConfirmation")}
							loading={deleting}
							onConfirm={() => onDelete(host.uid)}
						>
							<button type="button" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive")}>
								<DeleteIcon />
								{t("delete")}
							</button>
						</DeleteConfirmDialog>
					)}
					<div className="ms-auto flex flex-row flex-wrap items-center gap-2">
						{!isCloneMode && onClone ? (
							<button
								type="button"
								onClick={() => onClone(host.uid)}
								disabled={saving || deleting}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{t("hostsPage.clone")}
							</button>
						) : null}
						<button
							type="button"
							onClick={() => onReset(host.uid)}
							disabled={!dirty || saving}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("reset")}
						</button>
						<button
							type="button"
							onClick={() => onSave(host.uid)}
							disabled={primaryDisabled || saving}
							className={buttonVariants({ size: "sm" })}
						>
							{primaryLabel}
						</button>
					</div>
				</>
			}
		/>
	);
};

type CreateHostModalProps = {
	open: boolean;
	onClose: () => void;
	inboundOptions: InboundOption[];
	onSubmit: (values: CreateHostValues) => void;
	isSubmitting: boolean;
	nodes?: NodeType[];
};

const CreateHostModal: FC<CreateHostModalProps> = ({
	open: isOpen,
	onClose,
	inboundOptions,
	onSubmit,
	isSubmitting,
	nodes,
}) => {
	const { t } = useTranslation();
	const initialRef = useRef<HTMLInputElement | null>(null);
	const [formState, setFormState] = useState<CreateHostValues>(() =>
		emptyCreateHostValues(inboundOptions[0]?.value ?? ""),
	);
	const [jsonText, setJsonText] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const updatingFromJsonRef = useRef(false);
	const selectedInbound = useMemo(
		() =>
			inboundOptions.find((option) => option.value === formState.inboundTag),
		[inboundOptions, formState.inboundTag],
	);
	const isWireGuardInbound = selectedInbound?.protocol === "wireguard";
	const remarkError = profileHostNameError(
		selectedInbound?.protocol,
		formState.remark,
	);
	const finalMaskError = finalMaskValidationError(
		fitHostToInbound(formState, selectedInbound).finalmask,
	);
	const finalMaskValid = finalMaskError === null;

	useEffect(() => {
		if (isOpen) {
			updatingFromJsonRef.current = false;
			setFormState(emptyCreateHostValues(inboundOptions[0]?.value ?? ""));
			setJsonError(null);
			setTimeout(() => initialRef.current?.focus(), 150);
		}
	}, [inboundOptions, isOpen]);

	const jsonPayload = useMemo(
		() => ({
			inboundTag: formState.inboundTag,
			...formatHostForApi(formState, selectedInbound),
		}),
		[formState, selectedInbound],
	);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		if (updatingFromJsonRef.current) {
			updatingFromJsonRef.current = false;
			return;
		}
		const formatted = JSON.stringify(jsonPayload, null, 2);
		setJsonText((current) => (current === formatted ? current : formatted));
		setJsonError(null);
	}, [isOpen, jsonPayload]);

	const handleJsonEditorChange = useCallback(
		(value: string) => {
			setJsonText(value);
			try {
				const parsed: unknown = JSON.parse(value);
				if (!isFinalMaskObject(parsed)) {
					throw new Error("Invalid JSON payload");
				}
				const payload = parsed;
				if (
					Object.hasOwn(payload, "finalmask") &&
					payload.finalmask !== null &&
					!isFinalMaskObject(payload.finalmask)
				) {
					throw new Error(t("hostsPage.error.finalMaskObject"));
				}
				updatingFromJsonRef.current = true;
				setFormState((current) => {
					let next = {
						...current,
						inboundTag:
							typeof payload.inboundTag === "string"
								? payload.inboundTag
								: current.inboundTag,
					};
					for (const key of Object.keys(EMPTY_HOST_DATA) as Array<
						keyof HostData
					>) {
						if (Object.hasOwn(payload, key)) {
							next = {
								...next,
								[key]: coerceHostValue(key, payload[key], current),
							};
						}
					}
					return next;
				});
				setJsonError(null);
			} catch (error) {
				setJsonError(error instanceof Error ? error.message : "Invalid JSON");
			}
		},
		[t],
	);

	const handleSubmit = () => {
		if (
			jsonError ||
			!finalMaskValid ||
			hostClientSettingsError(formState.client_settings) ||
			!certificatePinsValid(formState.pinned_peer_cert_sha256) ||
			!formState.inboundTag ||
			!formState.remark.trim() ||
			Boolean(remarkError) ||
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
		<HostDialogShell
			open={isOpen}
			onClose={onClose}
			title={t("hostsPage.create.title")}
			subtitle={t("hostsPage.create.description")}
			initialFocusRef={initialRef}
			form={
				<HostForm
					data={formState}
					inboundTag={formState.inboundTag}
					inboundOptions={inboundOptions}
					nodes={nodes}
					initialFocusRef={initialRef}
					onChange={(key, value) => setFormState((current) => ({ ...current, [key]: value }))}
					onChangeInbound={(value) => setFormState((current) => ({ ...current, inboundTag: value }))}
				/>
			}
			json={
				<div className="flex flex-col items-stretch gap-3">
					<Suspense fallback={<Spinner />}>
						<JsonEditor json={jsonText} onChange={handleJsonEditorChange} />
					</Suspense>
					{jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
				</div>
			}
			footer={
				<>
					<button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
						{t("hostsPage.cancel")}
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={
							isSubmitting ||
							Boolean(jsonError) ||
							!finalMaskValid ||
							Boolean(hostClientSettingsError(formState.client_settings)) ||
							!certificatePinsValid(formState.pinned_peer_cert_sha256) ||
							!formState.inboundTag ||
							!formState.remark.trim() ||
							Boolean(remarkError) ||
							!rotationTextToOptions(formState.address).length ||
							(isWireGuardInbound && (!formState.dns_primary.trim() || !formState.dns_secondary.trim()))
						}
						className={cn(buttonVariants({ size: "sm" }), "ms-auto")}
					>
						{t("hostsPage.create.submit")}
					</button>
				</>
			}
		/>
	);
};
export const HostsManager: FC = () => {
	const { t } = useTranslation();
	
	const hosts = useHosts((state) => state.hosts);
	const fetchHostsStore = useHosts((state) => state.fetchHosts);
	const invalidateLabels = useInvalidateLabels();
	const fetchHosts = useCallback(async () => {
		await fetchHostsStore();
		void invalidateLabels();
	}, [fetchHostsStore, invalidateLabels]);
	const isLoading = useHosts((state) => state.loading);
	const isPostLoading = useHosts((state) => state.isPostLoading);
	const setHosts = useHosts((state) => state.setHosts);
	const setHostStatus = useHosts((state) => state.setHostStatus);
	const inbounds = useDashboard((state) => state.inbounds);
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
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const [createOpen, setCreateOpen] = useState(false);
	const [savingHostUid, setSavingHostUid] = useState<string | null>(null);
	const [deletingUid, setDeletingUid] = useState<string | null>(null);
	const [hostPendingDelete, setHostPendingDelete] = useState<HostState | null>(null);
	const [bulkAction, setBulkAction] = useState<
		"enable" | "disable" | "delete" | null
	>(null);

	const showHostValidationError = useCallback(
		(errors: string[]) => {
			if (!errors.length) {
				return false;
			}
			toast.error(t("hostsPage.error.invalidHost"), { description: errors[0].startsWith("hostsPage.")
					? t(errors[0])
					: errors[0] });
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
				if (["mtproto", "web"].includes(inbound.protocol.toLowerCase())) {
					return;
				}
				options.push({
					label: `${inbound.tag} (${inbound.protocol.toUpperCase()} - ${inbound.network})`,
					value: inbound.tag,
					protocol: inbound.protocol,
					network: inbound.network,
					headerType: inbound.header_type,
					alpn: inbound.alpn,
					tls: inbound.tls,
					flow: inbound.flow,
					proxyNetwork:
						typeof inbound.settings?.network === "string"
							? inbound.settings.network
							: undefined,
					port: inbound.port,
					validationError: (inbound as { validation_error?: string }).validation_error,
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

	const [tagFilter, setTagFilter] = useState<LabelFilterValue>(EMPTY_LABEL_FILTER);
	const filteredHosts = useMemo(() => {
		const tagged = tagFilter.tags.length
			? baseFilteredHosts.filter((host) =>
					matchesTagFilter(host.data.tags, tagFilter),
				)
			: baseFilteredHosts;
		if (!searchQuery.trim()) {
			return tagged;
		}
		return tagged.filter((host) => {
			const values = [
				host.data.remark,
				host.data.address,
				host.data.host,
				host.data.path,
				host.data.sni,
				host.inboundTag,
				host.data.port != null ? String(host.data.port) : "",
			];
			return matchesAnySearch(values, searchQuery, searchMatch);
		});
	}, [baseFilteredHosts, searchMatch, searchQuery, tagFilter]);

	const displayedHosts = filteredHosts;

	const hasLoadedHosts = hostItemsRef.current.length > 0;
	const isInitialLoading = isLoading && !hasLoadedHosts;
	const isRefreshing = isLoading && hasLoadedHosts;
	const isSearchActive = searchQuery.trim().length > 0;
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
				prev.map((host) => (host.uid === uid ? { ...host, inboundTag } : host)),
			),
		);
	};

	const saveHost = async (uid: string) => {
		const host = hostItemsRef.current.find((item) => item.uid === uid);
		if (!host) return;
		if (
			showHostValidationError(
				validateHostState(
					host.inboundTag,
					host.data,
					inboundOptions.find((option) => option.value === host.inboundTag),
				),
			)
		) {
			return;
		}
		setSavingHostUid(uid);
		try {
			const payload = buildInboundPayload(
				hostItemsRef.current,
				[host.inboundTag, host.initialInboundTag],
				inboundOptions,
				uid,
			);
			await setHosts(payload);
			await fetchHosts();
			toast.success(t("hostsPage.saved"));
			setSelectedHostUid(null);
		} catch (_error) {
			toast.error(t("hostsPage.error.save"));
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
		setCloneHost((prev) => {
			if (!prev || prev.uid !== uid) return prev;
			return {
				...prev,
				data: { ...prev.data, [key]: value },
			};
		});
	};

	const updateCloneInbound = (uid: string, inboundTag: string) => {
		setCloneHost((prev) => {
			if (!prev || prev.uid !== uid) return prev;
			return {
				...prev,
				inboundTag,
			};
		});
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
				validateHostState(
					cloneHost.inboundTag,
					cloneHost.data,
					inboundOptions.find(
						(option) => option.value === cloneHost.inboundTag,
					),
				),
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
			toast.error(t("hostsPage.clone.error"));
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
			const payload = buildInboundPayload(
				nextHosts,
				[cloneHost.inboundTag],
				inboundOptions,
				newHost.uid,
			);
			await setHosts(payload);
			await fetchHosts();
			toast.success(t("hostsPage.clone.created"));
			setCloneHost(null);
		} catch (_error) {
			applyHostItems(previousHosts);
			toast.error(t("hostsPage.clone.error"));
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
			if (!updatedHost.data.id) {
				throw new Error("Host ID is missing");
			}
			await setHostStatus(updatedHost.data.id, !isActive);
			await fetchHosts();
		} catch (_error) {
			applyHostItems(previousHosts);
			toast.error(t("hostsPage.error.save"));
		} finally {
			setSavingHostUid(null);
		}
	};

	const handleDeleteHost = async (uid: string) => {
		const host = hostItemsRef.current.find((item) => item.uid === uid);
		if (!host) return;
		const previousHosts = hostItemsRef.current;
		setDeletingUid(uid);
		try {
			const nextHosts = previousHosts.filter((item) => item.uid !== uid);
			applyHostItems(nextHosts);
			const payload = buildInboundPayload(
				nextHosts,
				[host.inboundTag, host.initialInboundTag],
				inboundOptions,
			);
			await setHosts(payload);
			await fetchHosts();
			toast.success(t("hostsPage.deleted"));
			if (selectedHostUid === uid) {
				setSelectedHostUid(null);
			}
		} catch (_error) {
			applyHostItems(previousHosts);
			toast.error(t("hostsPage.error.delete"));
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
			const payload = buildInboundPayload(
				nextHosts,
				affectedTags,
				inboundOptions,
			);
			await setHosts(payload);
			await fetchHosts();
			setSelectedHostUids([]);
			toast.success(isActive
					? t("hostsPage.bulkEnabled")
					: t("hostsPage.bulkDisabled"));
		} catch (_error) {
			applyHostItems(previousHosts);
			toast.error(t("hostsPage.error.save"));
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
			const payload = buildInboundPayload(
				nextHosts,
				affectedTags,
				inboundOptions,
			);
			await setHosts(payload);
			await fetchHosts();
			setSelectedHostUids([]);
			toast.success(t("hostsPage.bulkDeleted"));
		} catch (_error) {
			applyHostItems(previousHosts);
			toast.error(t("hostsPage.error.delete"));
		} finally {
			setBulkAction(null);
		}
	};

	const handleCreateHost = async (values: CreateHostValues) => {
		if (
			showHostValidationError(
				validateHostState(
					values.inboundTag,
					values,
					inboundOptions.find((option) => option.value === values.inboundTag),
				),
			)
		) {
			return;
		}
		setSavingHostUid("create");
		try {
			const { inboundTag, ...hostData } = values;
			const newData = cloneHostData({ ...hostData, id: null });
			const newHost: HostState = {
				uid: createUid(),
				inboundTag,
				initialInboundTag: inboundTag,
				data: newData,
				original: cloneHostData(newData),
			};

			const nextHosts = sortHosts([...hostItemsRef.current, newHost]);
			applyHostItems(nextHosts);

			const payload = buildInboundPayload(
				nextHosts,
				[inboundTag],
				inboundOptions,
				newHost.uid,
			);
			await setHosts(payload);
			await fetchHosts();
			toast.success(t("hostsPage.created"));
			setCreateOpen(false);
		} catch (_error) {
			toast.error(t("hostsPage.error.create"));
		} finally {
			setSavingHostUid(null);
		}
	};

	const { i18n } = useTranslation();
	const locale = i18n.language || "en";

	const hostOverview = useMemo(() => {
		const total = allHosts.length;
		const disabled = allHosts.filter((host) => host.data.is_disabled).length;
		const inboundCount = new Set(allHosts.map((host) => host.inboundTag)).size;
		const withSni = allHosts.filter((host) => Boolean(host.data.sni?.trim())).length;
		const tones = ["bg-panel-info", "bg-panel-accent", "bg-panel-text-muted/60"];
		const segments = proxyHostSecurity.map((option, index) => ({
			key: option.value,
			label: option.title,
			value: allHosts.filter(
				(host) => (host.data.security || "inbound_default") === option.value,
			).length,
			tone: tones[index],
		}));
		const isFiltered = displayedHosts.length !== total;

		return {
			total: {
				label: t("total"),
				value: total,
				caption: isFiltered
					? `${t("usersPage.filtered")}: ${displayedHosts.length}`
					: `${t("pages.xray.Inbounds")}: ${inboundCount}`,
			},
			rows: [
				{
					key: "enabled",
					label: t("nodes.enabled"),
					value: total - disabled,
					tone: "bg-panel-success",
				},
				{
					key: "disabled",
					label: t("nodes.disabled"),
					value: disabled,
					tone: "bg-panel-danger",
				},
			],
			distribution: { label: t("hostsDialog.security"), segments },
			extra: {
				label: t("hostsDialog.sni"),
				value: withSni,
				caption: total ? `${Math.round((withSni / total) * 100)}%` : undefined,
			},
		};
	}, [allHosts, displayedHosts.length, t]);

	const renderRotationValues = useCallback(
		(value: string, emptyLabel: string) => {
			const values = rotationTextToOptions(value);
			if (!values.length) {
				return <p className="text-panel-text-muted">{emptyLabel}</p>;
			}
			const visible = values.slice(0, 2);
			const hiddenCount = values.length - visible.length;
			return (
				<Tooltip>
<TooltipTrigger asChild>
					<div className="flex flex-row items-center gap-1 flex-wrap max-w-full">
						{visible.map((item) => (
							<Badge key={item} className="max-w-[120px]">
								<span className="truncate">
									{item}
								</span>
							</Badge>
						))}
						{hiddenCount > 0 && (
							<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
								+{hiddenCount}
							</Badge>
						)}
					</div>
				</TooltipTrigger>
<TooltipContent>{values.join(", ")}</TooltipContent>
</Tooltip>
			);
		},
		[],
	);

	const [hostSorting, setHostSorting] = useState<SortingState>([]);
	const hostColumns = useMemo<DataTableColumn<HostState>[]>(
		() => [
			{
				id: "remark",
				sortValue: (host) => host.data.remark ?? "",
				header: t("hostsPage.host"),
				isPrimary: true,
				priority: "primary",
				width: { base: "150px", lg: "160px", xl: "180px" },
				minWidth: "130px",
				maxWidth: "220px",
				mobilePriority: 0,
				mobileMetaLabel: t("hostsPage.host"),
				cell: (host) => {
					const dirty = isHostDirty(host);
					const hostName = host.data.remark || t("hostsPage.untitledHost");
					return (
						<div className="flex flex-col gap-0.5 min-w-0!">
							<Tooltip>
<TooltipTrigger asChild>
								<p className="font-semibold truncate">
									<AppleEmojiText>{hostName}</AppleEmojiText>
								</p>
							</TooltipTrigger>
<TooltipContent>{<AppleEmojiText>{hostName}</AppleEmojiText>}</TooltipContent>
</Tooltip>
							<div className="flex flex-row items-center gap-1 flex-wrap">
								{host.data.id != null && (
									<p className="text-[0.75rem] text-panel-text-muted">
										ID: {host.data.id}
									</p>
								)}
								{dirty && (
									<Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-500/20 dark:text-orange-200">
										{t("hostsPage.unsaved")}
									</Badge>
								)}
							</div>
						</div>
					);
				},
			},
			{
				id: "status",
				sortValue: (host) => (host.data.is_disabled ? 1 : 0),
				header: t("usersTable.status"),
				priority: "high",
				width: "112px",
				minWidth: "96px",
				maxWidth: "128px",
				headerAlign: "start",
				cellAlign: "start",
				mobilePriority: 1,
				mobileMetaLabel: t("usersTable.status"),
				cell: (host) => (
					<p className={cn("text-[0.875rem] font-semibold", host.data.is_disabled ? "text-red-400" : "text-green-400")}>
						{t(
							host.data.is_disabled ? "hostsPage.inactive" : "hostsPage.active",
						)}
					</p>
				),
			},
			{
				id: "address",
				sortValue: (host) => host.data.address ?? "",
				header: t("hostsDialog.address"),
				priority: "high",
				width: { base: "210px", lg: "240px", xl: "280px" },
				minWidth: "170px",
				maxWidth: "320px",
				mobilePriority: 1,
				mobileMetaLabel: t("hostsDialog.address"),
				cell: (host) =>
					renderRotationValues(host.data.address, t("hostsPage.noAddress")),
			},
			{
				id: "port",
				sortValue: (host) => host.data.port ?? 0,
				header: t("port"),
				priority: "high",
				width: "72px",
				minWidth: "64px",
				maxWidth: "82px",
				mobilePriority: 2,
				mobileMetaLabel: t("port"),
				cell: (host) =>
					host.data.port != null ? (
						<p dir="ltr" className="font-semibold [unicode-bidi:isolate]">
							{host.data.port}
						</p>
					) : (
						<p className="text-panel-text-muted">-</p>
					),
			},
			{
				id: "inbound",
				sortValue: (host) => host.inboundTag ?? "",
				header: t("hostsPage.inboundLabel"),
				priority: "high",
				width: { base: "150px", lg: "160px", xl: "190px" },
				minWidth: "130px",
				maxWidth: "230px",
				mobilePriority: 3,
				mobileMetaLabel: t("hostsPage.inboundLabel"),
				cell: (host) => {
					const inbound = inboundOptions.find(
						(option) => option.value === host.inboundTag,
					);
					return (
						<div className="flex flex-col gap-0.5 min-w-0!">
							<p className="font-semibold truncate">
								{host.inboundTag}
							</p>
							{(!inbound || inbound.validationError) && (
								<Tooltip>
<TooltipTrigger asChild>
									<Badge className={cn("bg-destructive/10 text-destructive", "w-fit")}>{t("diagnostics.broken")}</Badge>
								</TooltipTrigger>
<TooltipContent>{inbound?.validationError || t("diagnostics.missingInbound", { tag: host.inboundTag })}</TooltipContent>
</Tooltip>
							)}
							<p className="text-[0.75rem] text-panel-text-muted truncate">
								{inbound
									? `${inbound.protocol.toUpperCase()} / ${inbound.network}`
									: t("hostsPage.unknownInbound")}
							</p>
						</div>
					);
				},
			},
			{
				id: "tags",
				header: t("tags.title"),
				priority: "low",
				hideBelow: "lg",
				width: "170px",
				maxWidth: "220px",
				mobilePriority: 7,
				mobileMetaLabel: t("tags.title"),
				cell: (host) => (
					<TagChips tags={host.data.tags} limit={2} />
				),
			},
			{
				id: "sni",
				sortValue: (host) => host.data.sni ?? "",
				header: t("hostsDialog.sni"),
				priority: "low",
				hideBelow: "xl",
				width: "180px",
				minWidth: "140px",
				maxWidth: "220px",
				mobilePriority: 4,
				mobileMetaLabel: t("hostsDialog.sni"),
				cell: (host) => renderRotationValues(host.data.sni, "-"),
			},
			{
				id: "request_host",
				sortValue: (host) => host.data.host ?? "",
				header: t("hostsDialog.host"),
				priority: "low",
				hideBelow: "xl",
				width: "180px",
				minWidth: "140px",
				maxWidth: "220px",
				mobilePriority: 5,
				mobileMetaLabel: t("hostsDialog.host"),
				cell: (host) => renderRotationValues(host.data.host, "-"),
			},
			{
				id: "security",
				sortValue: (host) => host.data.security ?? "",
				header: t("hostsDialog.security"),
				priority: "low",
				hideBelow: "xl",
				width: "130px",
				maxWidth: "150px",
				mobilePriority: 6,
				mobileMetaLabel: t("hostsDialog.security"),
				cell: (host) => (
					<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
						{host.data.security || "inbound_default"}
					</Badge>
				),
			},
		],
		[inboundOptions, renderRotationValues, t],
	);

	const hostRowActions = (host: HostState): DataTableRowAction<HostState>[] => {
		const isActive = !host.data.is_disabled;
		return [
			{
				id: "edit",
				label: t("edit"),
				icon: <EditIcon />,
				onClick: () => setSelectedHostUid(host.uid),
			},
			{
				id: "toggle",
				label: isActive ? t("phpmyadmin.disableAction") : t("hostsPage.enable"),
				icon: isActive ? (
					<CircleX className="w-[16px]" />
				) : (
					<CircleCheck className="w-[16px]" />
				),
				onClick: () => toggleActive(host.uid, !isActive),
				disabled: isPostLoading,
			},
			{
				id: "delete",
				label: t("delete"),
				icon: <Trash2 className="w-[16px]" />,
				isDanger: true,
				onClick: () => setHostPendingDelete(host),
			},
		];
	};

	return (
		<div className="flex flex-col items-stretch gap-4">
			<ConfirmDialog
				open={Boolean(hostPendingDelete)}
				onClose={() => {
					if (isPostLoading) return;
					setHostPendingDelete(null);
				}}
				onConfirm={async () => {
					if (!hostPendingDelete) return;
					await handleDeleteHost(hostPendingDelete.uid);
					setHostPendingDelete(null);
				}}
				title={t("common.confirmAction")}
				description={t("hostsPage.deleteConfirmation")}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={isPostLoading}
			/>
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand
					total={hostOverview.total}
					rows={hostOverview.rows}
					distribution={hostOverview.distribution}
					extra={hostOverview.extra}
					locale={locale}
				/>
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 md:flex-row md:items-center">
						<div className="min-w-0 flex-1"><div className="flex flex-col gap-2 md:flex-row md:items-center">
					<div className="flex min-w-0 flex-1 flex-row items-center gap-2">
					<SearchInput value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("hostsPage.searchPlaceholder")} containerProps={{ className: "min-w-0 flex-1 md:w-[320px] md:flex-none" }} matchOptions={searchMatch} onMatchOptionsChange={setSearchMatch} />
					<DataTableSortMenu
						options={buildSortOptions(hostColumns, displayedHosts)}
						sorting={hostSorting}
						onSortingChange={setHostSorting}
					/>
					</div>
					<TagFilterButton type="host" value={tagFilter} onChange={setTagFilter} />
					<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={includeDisabled} onCheckedChange={(checked: boolean) => setIncludeDisabled(checked)} /><span>{t("hostsPage.showDisabled")}</span></label>
				</div></div>
						<div className="flex shrink-0 items-center justify-end gap-1">
							<ResourceRefreshButton
								aria-label={t("hostsPage.refresh")}
								label={t("hostsPage.refresh")}
								icon={<RefreshCw className="w-[16px]" />}
								loading={isRefreshing}
								onClick={fetchHosts}
							/>
							<Button onClick={() => setCreateOpen(true)} disabled={!inboundOptions.length} size="sm" className="h-[36px] px-3 rounded-[4px]">{<AddIcon />}
								{t("hostsPage.addHost")}
							</Button>
						</div>
					</div>
				</div>
			</div>

			<DataTable
				ariaLabel={t("hostsPage.tabHosts")}
				data={displayedHosts}
				columns={hostColumns}
				sorting={hostSorting}
				onSortingChange={setHostSorting}
				showSortMenu={false}
				getRowId={(host) => host.uid}
				loading={isInitialLoading}
				loadingRows={5}
				emptyState={
					<div className="text-center text-panel-text-muted">
						{showSearchEmptyState
							? t("hostsPage.searchEmpty")
							: t("hostsPage.emptyState")}
					</div>
				}
				rowActions={hostRowActions}

				actionsPlacement="end"
				actionsColumnWidth="60px"

				enableSelection
				selectedRowIds={selectedHostUids}
				selectedCount={selectedHostUids.length}
				onSelectionChange={(rowIds) => setSelectedHostUids(rowIds)}
				selectedLabel={t("hostsPage.selectedCount", {
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
							<Button disabled={
									Boolean(bulkAction) ||
									isPostLoading ||
									enableTargets.length === 0
								} onClick={() => handleBulkToggleHosts(enableTargets, true)} variant="outline" size="sm" loading={bulkAction === "enable"}>{<CircleCheck className="w-[16px]" />}
								{t("hostsPage.enable")}
							</Button>
							<Button disabled={
									Boolean(bulkAction) ||
									isPostLoading ||
									disableTargets.length === 0
								} onClick={() => handleBulkToggleHosts(disableTargets, false)} variant="outline" size="sm" loading={bulkAction === "disable"}>{<CircleX className="w-[16px]" />}
								{t("phpmyadmin.disableAction")}
							</Button>
							<DeleteConfirmDialog
								description={t("hostsPage.confirmBulkDelete", {
									count: selectedRows.length,
								})}
								loading={bulkAction === "delete"}
								disabled={selectedRows.length === 0}
								onConfirm={() => handleBulkDeleteHosts(selectedRows)}
							>
								<Button disabled={
										Boolean(bulkAction) ||
										isPostLoading ||
										selectedRows.length === 0
									} variant="outline" size="sm" loading={bulkAction === "delete"} className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">{<Trash2 className="w-[16px]" />}
									{t("delete")}
								</Button>
							</DeleteConfirmDialog>
						</>
					);
				}}
				mobileBreakpoint="md"
				tableProps={{ className: "w-full [table-layout:fixed] [&_th]:px-2 [&_td]:px-2 [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:align-middle [&_td]:align-middle xl:[&_th]:px-2.5 xl:[&_td]:px-2.5" }}
			/>

			{createOpen && (
				<CreateHostModal
					open={createOpen}
					onClose={() => setCreateOpen(false)}
					inboundOptions={inboundOptions}
					onSubmit={handleCreateHost}
					isSubmitting={savingHostUid === "create" && isPostLoading}
					nodes={nodes}
				/>
			)}

			{selectedHost && (
				<HostDetailModal
					host={selectedHost}
					inboundOptions={inboundOptions}
					open={Boolean(selectedHost)}
					onClose={() => setSelectedHostUid(null)}
					onChange={updateHost}
					onChangeInbound={updateHostInbound}
					onSave={saveHost}
					onReset={resetHost}
					onDelete={handleDeleteHost}
					onClone={openCloneModal}
					saving={
						!!selectedHost &&
						savingHostUid === selectedHost.uid &&
						isPostLoading
					}
					deleting={
						!!selectedHost && deletingUid === selectedHost.uid && isPostLoading
					}
					nodes={nodes}
				/>
			)}

			{cloneHost && (
				<HostDetailModal
					host={cloneHost}
					inboundOptions={inboundOptions}
					open={Boolean(cloneHost)}
					onClose={() => setCloneHost(null)}
					onChange={updateCloneHost}
					onChangeInbound={updateCloneInbound}
					onSave={addCloneHost}
					onReset={resetCloneHost}
					onDelete={() => {}}
					mode="clone"
					saving={
						!!cloneHost && savingHostUid === cloneHost.uid && isPostLoading
					}
					deleting={false}
					nodes={nodes}
				/>
			)}
		</div>
	);
};

export default HostsManager;
