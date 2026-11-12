import { toneClass } from "lib/tone";
import { Alert, AlertDescription } from "components/ui/alert";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Badge } from "components/ui/badge";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Textarea } from "components/ui/textarea";
import { Dialog } from "components/ui/dialog";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { cn } from "lib/cn";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetch as apiFetch } from "service/http";
import { Outbound, SizeFormatter } from "../utils/outbound";
import {
	ensureWireguardGlobal,
	generateWireguardKeypair,
} from "../utils/wireguard";
import { NumericInput } from "./common/NumericInput";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type WarpAccount = {
	device_id: string;
	access_token: string;
	license_key?: string | null;
	private_key: string;
	public_key?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

type WarpRemoteConfig = {
	id?: string;
	name?: string;
	model?: string;
	enabled?: boolean;
	account?: {
		account_type?: string;
		role?: string;
		premium_data?: number;
		quota?: number;
		usage?: number;
	};
	config?: {
		client_id?: string;
		interface?: {
			mtu?: number;
			addresses?: {
				v4?: string;
				v6?: string;
			};
		};
		peers?: Array<{
			public_key?: string;
			allowed_ips?: string[];
			allowedIPs?: string[];
			endpoint?:
				| string
				| {
						host?: string;
						port?: number;
				  };
			keep_alive?: number;
			keepAlive?: number;
		}>;
	};
};

type OutboundJson = Record<string, any>;

interface WarpModalProps {
	open: boolean;
	onClose: () => void;
	initialOutbound?: OutboundJson | null;
	onSave: (outbound: OutboundJson) => void;
	onDelete: () => void;
}

type WarpFormState = {
	tag: string;
	privateKey: string;
	publicKey: string;
	endpoint: string;
	addressV4: string;
	addressV6: string;
	reserved: string;
	mtu: number;
	domainStrategy: string;
	notes: string;
};

const DEFAULT_WARP_FORM: WarpFormState = {
	tag: "warp",
	privateKey: "",
	publicKey: "",
	endpoint: "engage.cloudflareclient.com:2408",
	addressV4: "",
	addressV6: "",
	reserved: "",
	mtu: 1420,
	domainStrategy: "ForceIP",
	notes: "",
};

const parseOutboundToForm = (outbound?: OutboundJson | null): WarpFormState => {
	if (!outbound) {
		return { ...DEFAULT_WARP_FORM };
	}

	const settings = outbound.settings ?? {};
	const peers = Array.isArray(settings.peers) ? settings.peers : [];
	const firstPeer = peers[0] ?? {};
	const addresses = Array.isArray(settings.address) ? settings.address : [];
	const addressV4 =
		addresses
			.find(
				(entry: string) => typeof entry === "string" && entry.endsWith("/32"),
			)
			?.replace("/32", "") ?? "";
	const addressV6 =
		addresses
			.find(
				(entry: string) => typeof entry === "string" && entry.endsWith("/128"),
			)
			?.replace("/128", "") ?? "";
	const reserved = Array.isArray(settings.reserved)
		? settings.reserved
				.filter((item: unknown) => Number.isFinite(Number(item)))
				.join(",")
		: "";

	return {
		tag: outbound.tag ?? "warp",
		privateKey: settings.secretKey ?? settings.privateKey ?? "",
		publicKey: firstPeer.publicKey ?? "",
		endpoint:
			typeof firstPeer.endpoint === "string"
				? firstPeer.endpoint
				: "engage.cloudflareclient.com:2408",
		addressV4,
		addressV6,
		reserved,
		mtu: settings.mtu ?? 1420,
		domainStrategy: settings.domainStrategy ?? "ForceIP",
		notes:
			typeof outbound.notes === "string"
				? outbound.notes
				: (settings.notes ?? ""),
	};
};

const buildOutboundFromForm = (form: WarpFormState): OutboundJson => {
	const addresses: string[] = [];
	if (form.addressV4.trim()) {
		addresses.push(`${form.addressV4.trim()}/32`);
	}
	if (form.addressV6.trim()) {
		addresses.push(`${form.addressV6.trim()}/128`);
	}
	const reserved = form.reserved
		.split(",")
		.map((item) => Number(item.trim()))
		.filter((value) => Number.isFinite(value));

	const outbound = Outbound.fromJson({
		tag: form.tag.trim() || "warp",
		protocol: "wireguard",
		settings: {
			mtu: form.mtu || 1420,
			secretKey: form.privateKey.trim(),
			address: addresses,
			reserved,
			domainStrategy: form.domainStrategy || "ForceIP",
			noKernelTun: false,
			peers: [
				{
					publicKey: form.publicKey.trim(),
					endpoint: form.endpoint.trim(),
				},
			],
		},
	});
	const json = outbound.toJson();
	if (form.notes.trim()) {
		json.notes = form.notes.trim();
	} else {
		delete json.notes;
	}
	return json;
};

const decodeReservedFromClientId = (clientId?: string): number[] => {
	if (!clientId) return [];
	try {
		const decoded = atob(clientId);
		return Array.from(decoded).map((char) => char.charCodeAt(0));
	} catch {
		return [];
	}
};

const normalizePeerEndpoint = (endpoint?: unknown): string => {
	if (!endpoint) return "";
	if (typeof endpoint === "string") return endpoint;
	if (typeof endpoint === "object" && endpoint !== null) {
		const ref = endpoint as { host?: string; port?: number };
		if (!ref.host) return "";
		return ref.port ? `${ref.host}:${ref.port}` : ref.host;
	}
	return "";
};

const buildOutboundFromWarpRemote = (
	account: WarpAccount,
	remote: WarpRemoteConfig | null,
): Outbound | null => {
	if (!account || !remote?.config) return null;
	const config = remote.config;
	const addresses: string[] = [];
	const addr = config.interface?.addresses ?? {};
	if (addr.v4) addresses.push(`${addr.v4}/32`);
	if (addr.v6) addresses.push(`${addr.v6}/128`);

	const peers = Array.isArray(config.peers) ? config.peers : [];
	const firstPeer = peers[0] ?? {};
	const allowedIPs = firstPeer.allowed_ips ??
		firstPeer.allowedIPs ?? ["0.0.0.0/0", "::/0"];

	const outbound = Outbound.fromJson({
		tag: "warp",
		protocol: "wireguard",
		settings: {
			mtu: config.interface?.mtu ?? 1420,
			secretKey: account.private_key,
			address: addresses,
			reserved: decodeReservedFromClientId(config.client_id),
			domainStrategy: "ForceIP",
			noKernelTun: false,
			peers: [
				{
					publicKey: firstPeer.public_key ?? account.public_key ?? "",
					endpoint: normalizePeerEndpoint(firstPeer.endpoint),
					allowedIPs,
					keepAlive: firstPeer.keep_alive ?? firstPeer.keepAlive ?? 0,
				},
			],
		},
	});

	return outbound;
};

const formatDate = (value?: string | null): string => {
	if (!value) return "-";
	try {
		return new Date(value).toLocaleString();
	} catch {
		return value;
	}
};

const formatBytes = (value?: number): string => {
	if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
		return "-";
	}
	return SizeFormatter.sizeFormat(value);
};

const InfoItem: FC<{ label: string; value: string }> = ({ label, value }) => {
	const muted = "text-gray-500 dark:text-gray-400";
	return (
		<div>
			<p className={cn("text-[0.75rem] uppercase tracking-wide", muted)}>
				{label}
			</p>
			<p className="font-semibold font-mono [overflow-wrap:anywhere]">
				{value || "-"}
			</p>
		</div>
	);
};

export const WarpModal: FC<WarpModalProps> = ({
	open: isOpen,
	onClose,
	initialOutbound,
	onSave,
	onDelete,
}) => {
	const { t } = useTranslation();
	

	const [form, setForm] = useState<WarpFormState>({ ...DEFAULT_WARP_FORM });
	const [warpAccount, setWarpAccount] = useState<WarpAccount | null>(null);
	const [warpRemote, setWarpRemote] = useState<WarpRemoteConfig | null>(null);
	const [warpOutboundCandidate, setWarpOutboundCandidate] =
		useState<Outbound | null>(null);
	const [licenseInput, setLicenseInput] = useState("");

	const [isAccountLoading, setIsAccountLoading] = useState(false);
	const [isRegistering, setIsRegistering] = useState(false);
	const [isUpdatingLicense, setIsUpdatingLicense] = useState(false);
	const [isFetchingInfo, setIsFetchingInfo] = useState(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);

	useEffect(() => {
		ensureWireguardGlobal();
	}, []);

	const loadAccount = useCallback(async () => {
		setIsAccountLoading(true);
		try {
			const response = await apiFetch<{ account: WarpAccount | null }>(
				"/core/warp",
				{ method: "GET" },
			);
			setWarpAccount(response.account ?? null);
			setWarpRemote(null);
			setWarpOutboundCandidate(null);
		} catch (error: any) {
			toast.error(t("pages.xray.warp.loadFailed"), { description: error?.data?.detail || error?.message, duration: 4000 });
		} finally {
			setIsAccountLoading(false);
		}
	}, [toast, t]);

	useEffect(() => {
		if (isOpen) {
			loadAccount().catch(() => undefined);
		}
	}, [isOpen, loadAccount]);

	useEffect(() => {
		if (isOpen) {
			setForm(parseOutboundToForm(initialOutbound));
		}
	}, [initialOutbound, isOpen]);

	useEffect(() => {
		setLicenseInput(warpAccount?.license_key ?? "");
	}, [warpAccount]);

	const updateFormField = <K extends keyof WarpFormState>(
		key: K,
		value: WarpFormState[K],
	) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const helperColor = "text-gray-600 dark:text-gray-300";
	const cardBorder = "border-gray-200! dark:border-whiteAlpha-200!";

	const handleGenerateKeys = () => {
		const keys = generateWireguardKeypair();
		updateFormField("privateKey", keys.privateKey);
		updateFormField("publicKey", keys.publicKey);
		toast.info(t("pages.xray.warp.keysGenerated"), { duration: 2500 });
	};

	const handleInsertReserved = () => {
		const randomValues = Array.from({ length: 3 }, () =>
			Math.floor(Math.random() * 256),
		);
		updateFormField("reserved", randomValues.join(","));
	};

	const hydrateFromRemote = useCallback(
		(account: WarpAccount | null, remoteConfig: WarpRemoteConfig | null) => {
			if (!account || !remoteConfig) {
				setWarpOutboundCandidate(null);
				return;
			}
			const outbound = buildOutboundFromWarpRemote(account, remoteConfig);
			if (outbound) {
				setWarpOutboundCandidate(outbound);
				setForm(parseOutboundToForm(outbound.toJson()));
			}
		},
		[],
	);

	const handleRegister = async () => {
		setIsRegistering(true);
		try {
			const keys = generateWireguardKeypair();
			const response = await apiFetch<{
				account: WarpAccount;
				config: WarpRemoteConfig;
			}>("/core/warp/register", {
				method: "POST",
				body: {
					private_key: keys.privateKey,
					public_key: keys.publicKey,
				},
			});
			setWarpAccount(response.account);
			setWarpRemote(response.config);
			hydrateFromRemote(response.account, response.config);
			toast.success(t("pages.xray.warp.registerSuccess"), { duration: 4000 });
		} catch (error: any) {
			toast.error(t("pages.xray.warp.registerFailed"), { description: error?.data?.detail || error?.message, duration: 5000 });
		} finally {
			setIsRegistering(false);
		}
	};

	const handleFetchInfo = async () => {
		if (!warpAccount) {
			toast.warning(t("pages.xray.warp.accountMissing"), { duration: 3000 });
			return;
		}
		setIsFetchingInfo(true);
		try {
			const response = await apiFetch<{ config: WarpRemoteConfig }>(
				"/core/warp/config",
				{ method: "GET" },
			);
			setWarpRemote(response.config);
			hydrateFromRemote(warpAccount, response.config);
			toast.success(t("pages.xray.warp.infoFetched"), { duration: 3000 });
		} catch (error: any) {
			toast.error(t("pages.xray.warp.infoFailed"), { description: error?.data?.detail || error?.message, duration: 5000 });
		} finally {
			setIsFetchingInfo(false);
		}
	};

	const handleUpdateLicense = async () => {
		if (!licenseInput.trim()) {
			return;
		}
		setIsUpdatingLicense(true);
		try {
			const response = await apiFetch<{ account: WarpAccount }>(
				"/core/warp/license",
				{
					method: "POST",
					body: { license_key: licenseInput.trim() },
				},
			);
			setWarpAccount(response.account);
			toast.success(t("pages.xray.warp.licenseUpdated"), { duration: 3000 });
		} catch (error: any) {
			toast.error(t("pages.xray.warp.licenseFailed"), { description: error?.data?.detail || error?.message, duration: 5000 });
		} finally {
			setIsUpdatingLicense(false);
		}
	};

	const handleDeleteAccount = async () => {
		setIsDeletingAccount(true);
		try {
			await apiFetch("/core/warp", { method: "DELETE" });
			setWarpAccount(null);
			setWarpRemote(null);
			setWarpOutboundCandidate(null);
			onDelete();
			toast.success(t("pages.xray.warp.accountRemoved"), { duration: 3000 });
		} catch (error: any) {
			toast.error(t("pages.xray.warp.removeFailed"), { description: error?.data?.detail || error?.message, duration: 5000 });
		} finally {
			setIsDeletingAccount(false);
		}
	};

	const applyOutboundCandidate = () => {
		if (!warpOutboundCandidate) {
			return;
		}
		const outboundJson = warpOutboundCandidate.toJson();
		onSave(outboundJson);
		toast.success(t("pages.xray.warp.outboundApplied"), { duration: 2500 });
	};

	const handleManualDelete = () => {
		onDelete();
		setForm({ ...DEFAULT_WARP_FORM });
		toast.info(t("pages.xray.warp.removeOutbound"), { duration: 2500 });
	};

	const handleManualSave = () => {
		if (
			!form.privateKey.trim() ||
			!form.publicKey.trim() ||
			!form.endpoint.trim()
		) {
			toast.error(t("pages.xray.warp.validationMissing"), { duration: 3500 });
			return;
		}
		const outboundJson = buildOutboundFromForm(form);
		onSave(outboundJson);
		onClose();
	};

	const isEditingOutbound = useMemo(
		() => Boolean(initialOutbound),
		[initialOutbound],
	);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<XrayModalHeader>
					{t("pages.xray.warp.manage")}
				</XrayModalHeader>
				
				<XrayModalBody>
					<div className="flex flex-col gap-5 items-stretch">
						<Alert className="rounded-md">
							<Info className="size-4" aria-hidden="true" />
							<AlertDescription>
								{t("pages.xray.warp.manualNote")}
							</AlertDescription>
						</Alert>

						<div className={cn("border rounded-lg p-4", cardBorder)}>
							{warpAccount ? (
								<div className="flex flex-col gap-4 items-stretch">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<InfoItem
											label={t("pages.xray.warp.accessToken")}
											value={warpAccount.access_token || "-"}
										/>
										<InfoItem
											label={t("pages.xray.warp.deviceId")}
											value={warpAccount.device_id || "-"}
										/>
										<InfoItem
											label={t("pages.xray.warp.licenseKey")}
											value={warpAccount.license_key || "-"}
										/>
										<InfoItem
											label={t("pages.xray.warp.privateKey")}
											value={warpAccount.private_key || "-"}
										/>
										<InfoItem
											label={t("pages.xray.warp.registeredAt")}
											value={formatDate(warpAccount.created_at)}
										/>
										<InfoItem
											label={t("pages.xray.warp.updatedAt")}
											value={formatDate(warpAccount.updated_at)}
										/>
									</div>
									<div className="flex flex-row items-center gap-3 flex-wrap">
										<Button onClick={handleFetchInfo} variant="outline" loading={isFetchingInfo}>
											{t("pages.xray.warp.fetchInfo")}
										</Button>
										<Button onClick={handleDeleteAccount} variant="ghost" loading={isDeletingAccount} className="text-destructive hover:bg-destructive/10">
											{t("pages.xray.warp.removeAccount")}
										</Button>
									</div>
								</div>
							) : (
								<div className="flex flex-col gap-3 items-stretch">
									<p className={cn("text-[0.875rem]", helperColor)}>
										{t("pages.xray.warp.registerDescription")}
									</p>
									<Button onClick={handleRegister} loading={isRegistering || isAccountLoading}>
										{t("pages.xray.warp.registerAction")}
									</Button>
								</div>
							)}
						</div>

						{warpAccount && (
							<div className={cn("border rounded-lg p-4", cardBorder)}>
								<p className="font-semibold mb-2">
									{t("pages.xray.warp.licenseSection")}
								</p>
								<div className="flex flex-row gap-3 items-stretch flex-wrap">
									<Input value={licenseInput} onChange={(event) => setLicenseInput(event.target.value)} />
									<Button onClick={handleUpdateLicense} disabled={!licenseInput.trim()} loading={isUpdatingLicense}>
										{t("pages.xray.warp.updateLicense")}
									</Button>
								</div>
								<p className={cn("text-[0.75rem] mt-2", helperColor)}>
									{t("pages.xray.warp.licenseHint")}
								</p>
							</div>
						)}

						<div className={cn("border rounded-lg p-4", cardBorder)}>
							<div className="flex flex-row gap-2 justify-between items-center mb-2">
								<p className="font-semibold">
									{t("pages.xray.warp.remoteConfig")}
								</p>
								{warpRemote ? (
									<Badge className={toneClass(warpRemote.enabled ? "green" : "yellow")}>
										{warpRemote.enabled
											? t("status.active")
											: t("core.pending")}
									</Badge>
								) : (
									<Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-500/20 dark:text-gray-200">{t("core.empty")}</Badge>
								)}
							</div>
							{warpRemote ? (
								<div className="flex flex-col gap-4">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<InfoItem
											label={t("nodes.nodeName")}
											value={warpRemote.name ?? "-"}
										/>
										<InfoItem
											label={t("core.model")}
											value={warpRemote.model ?? "-"}
										/>
										<InfoItem
											label={t("status")}
											value={
												warpRemote.enabled
													? t("nodes.enabled")
													: t("nodes.disabled")
											}
										/>
										<InfoItem
											label={t("admins.idLabel")}
											value={warpRemote.id ?? "-"}
										/>
									</div>
									{warpRemote.account && (
										<>
											<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
											<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
												<InfoItem
													label={t("inbounds.fallbacks.type")}
													value={warpRemote.account.account_type ?? "-"}
												/>
												<InfoItem
													label={t("core.role")}
													value={warpRemote.account.role ?? "-"}
												/>
												<InfoItem
													label={t("pages.xray.warp.premiumData")}
													value={formatBytes(warpRemote.account.premium_data)}
												/>
												<InfoItem
													label={t("core.quota")}
													value={formatBytes(warpRemote.account.quota)}
												/>
												<InfoItem
													label={t("topAdminUsage")}
													value={formatBytes(warpRemote.account.usage)}
												/>
											</div>
										</>
									)}
									<div className="flex flex-row items-center gap-3 flex-wrap">
										<Button onClick={applyOutboundCandidate} disabled={!warpOutboundCandidate}>
											{t("pages.xray.warp.applyGenerated")}
										</Button>
										<Button onClick={() => setWarpRemote(null)} variant="ghost">
											{t("reset")}
										</Button>
									</div>
								</div>
							) : (
								<p className={cn("text-[0.875rem]", helperColor)}>
									{t("pages.xray.warp.remoteEmpty")}
								</p>
							)}
						</div>

						<div className={cn("border rounded-lg p-4", cardBorder)}>
							<p className="font-semibold mb-2">
								{t("pages.xray.warp.manualTitle")}
							</p>
							<div className="flex flex-col gap-4">
								<Field>
									<FieldLabel>{t("pages.xray.outbound.tag")}</FieldLabel>
									<Input value={form.tag} onChange={(event) =>
											updateFormField("tag", event.target.value)
										} />
								</Field>

								<Field>
									<FieldLabel>{t("pages.xray.warp.privateKey")}</FieldLabel>
									<Textarea value={form.privateKey} onChange={(event) =>
											updateFormField("privateKey", event.target.value)
										} rows={2} />
								</Field>

								<Field>
									<FieldLabel>{t("pages.xray.warp.publicKey")}</FieldLabel>
									<Textarea value={form.publicKey} onChange={(event) =>
											updateFormField("publicKey", event.target.value)
										} rows={2} />
								</Field>

								<Field>
									<Button onClick={handleGenerateKeys} size="sm">
										{t("pages.xray.warp.generateKeys")}
									</Button>
									<p className={cn("text-[0.75rem] mt-1", helperColor)}>
										{t("pages.xray.warp.generateKeysHint")}
									</p>
								</Field>

								<Field>
									<FieldLabel>{t("pages.xray.warp.endpoint")}</FieldLabel>
									<Input value={form.endpoint} onChange={(event) =>
											updateFormField("endpoint", event.target.value)
										} />
								</Field>

								<Field>
									<FieldLabel>
										{t("pages.xray.warp.addressV4")}
									</FieldLabel>
									<Input value={form.addressV4} onChange={(event) =>
											updateFormField("addressV4", event.target.value)
										} />
									<FieldDescription>
										{t("pages.xray.warp.addressV4Hint")}
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel>
										{t("pages.xray.warp.addressV6")}
									</FieldLabel>
									<Input value={form.addressV6} onChange={(event) =>
											updateFormField("addressV6", event.target.value)
										} />
								</Field>

								<Field>
									<FieldLabel>{t("pages.xray.warp.reserved")}</FieldLabel>
									<Input value={form.reserved} onChange={(event) =>
											updateFormField("reserved", event.target.value)
										} />
									<FieldDescription>
										{t("pages.xray.warp.reservedHint")}
									</FieldDescription>
									<Button onClick={handleInsertReserved} variant="ghost" size="xs" className="mt-2">
										{t("pages.xray.warp.randomReserved")}
									</Button>
								</Field>

								<Field>
									<FieldLabel>{t("pages.xray.warp.mtu")}</FieldLabel>
									<NumericInput
										size="sm"
										min={576}
										max={1600}
										value={form.mtu}
										onChange={(_, value) =>
											updateFormField("mtu", value || 1420)
										}
									/>
								</Field>

								<Field>
									<FieldLabel>
										{t("pages.xray.warp.notes")}
									</FieldLabel>
									<Textarea rows={2} value={form.notes} onChange={(event) =>
											updateFormField("notes", event.target.value)
										} />
								</Field>
							</div>
						</div>
					</div>
				</XrayModalBody>
				<XrayModalFooter className="flex justify-between">
					{isEditingOutbound ? (
						<Button onClick={handleManualDelete} variant="outline" className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">
							{t("delete")}
						</Button>
					) : (
						<span />
					)}
					<div className="flex flex-row items-center gap-3">
						<Button onClick={onClose} variant="ghost">
							{t("cancel")}
						</Button>
						<Button onClick={handleManualSave}>
							{isEditingOutbound ? t("save") : t("add")}
						</Button>
					</div>
				</XrayModalFooter>
			</XrayModalContent>
		</Dialog>
	);
};
