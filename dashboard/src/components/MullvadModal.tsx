import { Alert, AlertDescription } from "components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { Button } from "components/ui/button";
import { Dialog } from "components/ui/dialog";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Download, Plus, RefreshCw, Signal } from "lucide-react";

import { cn } from "lib/cn";
import { FileDropzone } from "components/common/FileDropzone";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { countryFlag, countryName } from "utils/countries";
import {
	buildMullvadOutbound,
	isMullvadFormValid,
	isMullvadOutbound,
	type MullvadForm,
	type MullvadServer,
	mullvadFormFromOutbound,
	nextMullvadTag,
	parseMullvadConfig,
	readMullvadZip,
} from "utils/mullvad";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type OutboundJson = Record<string, any>;

type Props = {
	open: boolean;
	onClose: () => void;
	initialOutbounds: OutboundJson[];
	onSave: (outbound: OutboundJson, replaceIndex: number | null) => void;
	onSaveMany: (outbounds: OutboundJson[]) => void;
	onDelete: (index: number) => void;
	// opens on this Mullvad outbound for editing; a new one when left out
	initialTag?: string;
	// pings run on the node of this target; the master template cannot ping
	targetID?: string;
	canPing?: boolean;
};

type PingResult = number | "failed" | "pending";
const PING_BATCH = 50;

const pingText = (ping?: PingResult) => {
	if (ping === undefined) return "";
	if (ping === "pending") return " · …";
	if (ping === "failed") return " · ✕";
	return ` · ${ping} ms`;
};

export const MullvadModal: FC<Props> = ({
	open: isOpen,
	onClose,
	initialOutbounds,
	onSave,
	onSaveMany,
	onDelete,
	initialTag,
	targetID,
	canPing = false,
}) => {
	const { t, i18n } = useTranslation();
	
	const [zipFile, setZipFile] = useState<File | null>(null);
	const [servers, setServers] = useState<MullvadServer[]>([]);
	const [country, setCountry] = useState("");
	const [serverName, setServerName] = useState("");

	const countryOptions = useMemo(() => {
		const counts = new Map<string, number>();
		for (const server of servers) {
			counts.set(server.country, (counts.get(server.country) ?? 0) + 1);
		}
		return Array.from(counts, ([code, count]) => {
			const name = countryName(code, i18n.language);
			return {
				value: code,
				label: `${countryFlag(code)} ${name} (${count})`,
				searchLabel: `${code} ${name}`,
				title: name,
			};
		}).sort((a, b) => a.title.localeCompare(b.title, i18n.language));
	}, [servers, i18n.language]);

	const [pings, setPings] = useState<Record<string, PingResult>>({});
	// fastest first once pinged; servers without a ping keep their order at the end
	const serverOptions = useMemo(() => {
		const rank = (name: string) => {
			const ping = pings[name];
			return typeof ping === "number" ? ping : Number.POSITIVE_INFINITY;
		};
		return servers
			.filter((server) => server.country === country)
			.sort((a, b) => rank(a.name) - rank(b.name))
			.map((server) => ({
				value: server.name,
				label: `${server.name}${pingText(pings[server.name])}`,
				searchLabel: server.name,
			}));
	}, [servers, country, pings]);

	// ICMP from the node to each server; no WireGuard session is opened
	const pingServers = async (names: string[]) => {
		if (!canPing || names.length === 0) return;
		setPings((prev) => ({
			...prev,
			...Object.fromEntries(names.map((name) => [name, "pending" as const])),
		}));
		for (let start = 0; start < names.length; start += PING_BATCH) {
			const batch = names.slice(start, start + PING_BATCH);
			const probes = batch.map((name) => ({
				tag: `mullvad-ping-${name}`,
				protocol: "wireguard",
				settings: {
					peers: [
						{
							endpoint:
								servers.find((server) => server.name === name)?.form
									.endpoint ?? "",
						},
					],
				},
			}));
			let results: Array<{ success?: boolean; delay?: number }> = [];
			try {
				const response = await apiFetch<{
					obj?: Array<{ success?: boolean; delay?: number }>;
				}>("/panel/xray/testOutbounds", {
					method: "POST",
					body: {
						outbounds: JSON.stringify(probes),
						target_id: targetID,
						test_type: "icmp",
					},
				});
				results = Array.isArray(response?.obj) ? response.obj : [];
			} catch {
				results = [];
			}
			setPings((prev) => ({
				...prev,
				...Object.fromEntries(
					batch.map((name, index) => {
						const result = results[index];
						return [
							name,
							result?.success && typeof result.delay === "number"
								? Math.round(result.delay)
								: ("failed" as const),
						];
					}),
				),
			}));
		}
	};
	const countryServerNames = serverOptions.map((option) => option.value);
	const pinging = Object.values(pings).includes("pending");

	const tags = initialOutbounds.map((outbound) => String(outbound?.tag ?? ""));
	const mullvadTags = initialOutbounds
		.filter(isMullvadOutbound)
		.map((outbound) => String(outbound.tag ?? ""))
		.filter(Boolean);

	// the Mullvad outbound being edited; "" while a new one is being made
	const [editingTag, setEditingTag] = useState(() =>
		initialTag && mullvadTags.includes(initialTag) ? initialTag : "",
	);
	const editingIndex = editingTag ? tags.indexOf(editingTag) : -1;
	const editingOutbound =
		editingIndex >= 0 ? initialOutbounds[editingIndex] : null;

	const [tag, setTag] = useState(() => editingTag || nextMullvadTag(tags));
	const [configText, setConfigText] = useState("");
	const [form, setForm] = useState<MullvadForm>(() =>
		mullvadFormFromOutbound(editingOutbound),
	);

	const countryServers = servers.filter((server) => server.country === country);
	const addableServers = countryServers.filter(
		(server) => !tags.some((item) => item.toLowerCase() === server.name.toLowerCase()),
	);

	const tagTaken = tags.some(
		(item, index) =>
			index !== editingIndex && item.toLowerCase() === tag.trim().toLowerCase(),
	);

	const edit = (nextTag: string, takenTags = tags) => {
		setEditingTag(nextTag);
		setTag(nextTag || nextMullvadTag(takenTags));
		setForm(
			mullvadFormFromOutbound(
				nextTag ? initialOutbounds[tags.indexOf(nextTag)] : null,
			),
		);
		setConfigText("");
	};

	const updateFormField = (field: keyof MullvadForm, value: string) =>
		setForm((prev) => ({ ...prev, [field]: value }));

	const fillFromConfig = () => {
		const parsed = parseMullvadConfig(configText);
		if (!parsed) {
			toast.error(t("pages.xray.mullvad.parseFailed"));
			return;
		}
		setForm(parsed);
		setConfigText("");
	};

	const loadZip = async (file: File | null) => {
		setZipFile(file);
		setServers([]);
		setCountry("");
		setServerName("");
		if (!file) return;
		const found = await file
			.arrayBuffer()
			.then(readMullvadZip)
			.catch(() => []);
		if (found.length === 0) {
			setZipFile(null);
			toast.error(t("pages.xray.mullvad.zipFailed"));
			return;
		}
		setServers(found);
	};

	const selectCountry = (code: string) => {
		setCountry(code);
		setServerName("");
	};

	const selectServer = (name: string) => {
		setServerName(name);
		const server = servers.find((item) => item.name === name);
		if (server) setForm(server.form);
	};

	const saveOutbound = () => {
		onSave(
			buildMullvadOutbound(tag, form, editingOutbound),
			editingIndex >= 0 ? editingIndex : null,
		);
		toast.success(editingIndex >= 0
					? t("pages.xray.mullvad.outboundUpdated")
					: t("pages.xray.mullvad.outboundAdded"));
		onClose();
	};

	const addCountryServers = () => {
		onSaveMany(addableServers.map((server) => buildMullvadOutbound(server.name, server.form)));
		const skipped = countryServers.length - addableServers.length;
		toast.success(t("pages.xray.mullvad.bulkAdded", { count: addableServers.length }));
		if (skipped > 0) {
			toast.warning(t("pages.xray.mullvad.bulkSkipped", { count: skipped }));
		}
		onClose();
	};

	// stays open and goes back to the empty window
	const deleteOutbound = () => {
		onDelete(editingIndex);
		edit(
			"",
			tags.filter((_, index) => index !== editingIndex),
		);
		void loadZip(null);
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<XrayModalHeader
					subtitle={
						editingIndex >= 0
							? t("pages.xray.mullvad.editingSubtitle", { tag: editingTag })
							: t("pages.xray.mullvad.newOutbound")
					}
				>
					Mullvad WireGuard
				</XrayModalHeader>
				
				<XrayModalBody>
					<div className="flex flex-col gap-4 items-stretch">
						<Alert className="rounded-md">
							<Info className="size-4" aria-hidden="true" />
							<AlertDescription className="text-[0.875rem]">
								{t("pages.xray.mullvad.oneKeyNote")}
							</AlertDescription>
						</Alert>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
							{mullvadTags.length > 0 && (
								<Field>
									<FieldLabel>{t("pages.xray.mullvad.editing")}</FieldLabel>
									<Select
										value={editingTag}
										options={[
											{ value: "", label: t("pages.xray.mullvad.newOutbound") },
											...mullvadTags,
										]}
										showSearch={false}
										onChange={(event) => edit(event.target.value)}
									/>
								</Field>
							)}
							<Field data-invalid={tagTaken}>
								<FieldLabel>{t("pages.xray.mullvad.name")}</FieldLabel>
								<Input dir="ltr" value={tag} onChange={(event) => setTag(event.target.value)} className={cn(tagTaken ? "text-gray-500" : "")} />
								{tagTaken && <FieldError>
									{t("pages.xray.mullvad.nameTaken")}
								</FieldError>}
							</Field>
						</div>
						<Field>
							<FieldLabel>{t("pages.xray.mullvad.config")}</FieldLabel>
							<Textarea dir="ltr" rows={5} value={configText} onChange={(event) => setConfigText(event.target.value)} className="font-mono" />
							<FieldDescription>
								{t("pages.xray.mullvad.configHelp")}
							</FieldDescription>
						</Field>
						<Button disabled={!configText.trim()} onClick={fillFromConfig} className="self-start">{<Download className="w-[16px]" />}
							{t("pages.xray.mullvad.fill")}
						</Button>
						<FileDropzone
							accept=".zip,application/zip"
							selectedFile={zipFile}
							title={t("pages.xray.mullvad.zipTitle")}
							description={t("pages.xray.mullvad.zipHint")}
							emptyText={t("pages.xray.mullvad.zipSelect")}
							onFileSelect={(file) => void loadZip(file)}
						/>
						{servers.length > 0 && (
							<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
								<Field>
									<FieldLabel>{t("pages.xray.mullvad.country")}</FieldLabel>
									<Select
										value={country}
										options={countryOptions}
										placeholder={t("pages.xray.mullvad.chooseCountry")}
										onChange={(event) => selectCountry(event.target.value)}
									/>
								</Field>
								<Field>
									<FieldLabel>{t("pages.xray.mullvad.server")}</FieldLabel>
									<Select
										value={serverName}
										options={serverOptions}
										placeholder={t("pages.xray.mullvad.chooseServer")}
										disabled={!country}
										onChange={(event) => selectServer(event.target.value)}
									/>
									<div className="flex flex-row items-center gap-2 mt-2">
										<Button disabled={!canPing || !serverName || pinging} onClick={() => void pingServers([serverName])} size="xs">{<Signal className="w-[14px]" />}
											{t("pages.xray.mullvad.ping")}
										</Button>
										<Button disabled={!canPing || !country || pinging} onClick={() => void pingServers(countryServerNames)} size="xs" loading={pinging}>{<Signal className="w-[14px]" />}
											{t("pages.xray.mullvad.pingAll")}
										</Button>
									</div>
									{!canPing && (
										<FieldDescription>
											{t("pages.xray.mullvad.pingNeedsNode")}
										</FieldDescription>
									)}
								</Field>
							</div>
						)}
						{editingIndex < 0 && country && (
							<Button disabled={addableServers.length === 0} onClick={addCountryServers} variant="outline" className="self-start">{<Plus className="w-[16px]" />}
								{t("pages.xray.mullvad.addCountry", { count: addableServers.length, country: countryName(country, i18n.language) })}
							</Button>
						)}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
							<Field>
								<FieldLabel>{t("inbounds.wireguard.privateKey")}</FieldLabel>
								<Input dir="ltr" value={form.privateKey} onChange={(event) =>
										updateFormField("privateKey", event.target.value)
									} className="font-mono" />
							</Field>
							<Field>
								<FieldLabel>{t("pages.xray.outbound.address")}</FieldLabel>
								<Input dir="ltr" value={form.address} onChange={(event) =>
										updateFormField("address", event.target.value)
									} className="font-mono" />
							</Field>
							<Field>
								<FieldLabel>{t("pages.xray.mullvad.serverPublicKey")}</FieldLabel>
								<Input dir="ltr" value={form.publicKey} onChange={(event) =>
										updateFormField("publicKey", event.target.value)
									} className="font-mono" />
							</Field>
							<Field>
								<FieldLabel>{t("pages.xray.warp.endpoint")}</FieldLabel>
								<Input dir="ltr" value={form.endpoint} onChange={(event) =>
										updateFormField("endpoint", event.target.value)
									} className="font-mono" />
							</Field>
						</div>
					</div>
				</XrayModalBody>
				<XrayModalFooter>
					<Button onClick={onClose} variant="ghost">
						{t("close")}
					</Button>
					<Button disabled={!tag.trim() || tagTaken || !isMullvadFormValid(form)} onClick={saveOutbound}>{<RefreshCw className="w-[16px]" />}
						{editingIndex >= 0
							? t("pages.xray.nord.updateOutbound")
							: t("pages.xray.outbound.addOutbound")}
					</Button>
					{editingIndex >= 0 && (
						<Button onClick={deleteOutbound} variant="outline" className="border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10">
							{t("delete")}
						</Button>
					)}
				</XrayModalFooter>
			</XrayModalContent>
		</Dialog>
	);
};
