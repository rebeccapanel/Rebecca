import {
	Alert,
	AlertDescription,
	AlertIcon,
	Button,
	HStack,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	SimpleGrid,
	Textarea,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	SignalIcon,
} from "@heroicons/react/24/outline";
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
	isOpen: boolean;
	onClose: () => void;
	initialOutbounds: OutboundJson[];
	onSave: (outbound: OutboundJson, replaceIndex: number | null) => void;
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
	isOpen,
	onClose,
	initialOutbounds,
	onSave,
	onDelete,
	initialTag,
	targetID,
	canPing = false,
}) => {
	const { t, i18n } = useTranslation();
	const toast = useToast();
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
			toast({
				title: t("pages.xray.mullvad.parseFailed"),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
			toast({
				title: t("pages.xray.mullvad.zipFailed"),
				status: "error",
				isClosable: true,
				position: "top",
			});
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
		toast({
			title:
				editingIndex >= 0
					? t("pages.xray.mullvad.outboundUpdated")
					: t("pages.xray.mullvad.outboundAdded"),
			status: "success",
			isClosable: true,
			position: "top",
		});
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
		<Modal isOpen={isOpen} onClose={onClose} size="3xl" isCentered>
			<ModalOverlay />
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
				<ModalCloseButton />
				<XrayModalBody>
					<VStack spacing={4} align="stretch">
						<Alert status="info" borderRadius="md">
							<AlertIcon />
							<AlertDescription fontSize="sm">
								{t("pages.xray.mullvad.oneKeyNote")}
							</AlertDescription>
						</Alert>
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
							{mullvadTags.length > 0 && (
								<FormControl>
									<FormLabel>{t("pages.xray.mullvad.editing")}</FormLabel>
									<Select
										value={editingTag}
										options={[
											{ value: "", label: t("pages.xray.mullvad.newOutbound") },
											...mullvadTags,
										]}
										showSearch={false}
										onChange={(event) => edit(event.target.value)}
									/>
								</FormControl>
							)}
							<FormControl isInvalid={tagTaken}>
								<FormLabel>{t("pages.xray.mullvad.name")}</FormLabel>
								<Input
									dir="ltr"
									value={tag}
									color={tagTaken ? "gray.500" : undefined}
									onChange={(event) => setTag(event.target.value)}
								/>
								<FormErrorMessage>
									{t("pages.xray.mullvad.nameTaken")}
								</FormErrorMessage>
							</FormControl>
						</SimpleGrid>
						<FormControl>
							<FormLabel>{t("pages.xray.mullvad.config")}</FormLabel>
							<Textarea
								dir="ltr"
								fontFamily="mono"
								rows={5}
								value={configText}
								onChange={(event) => setConfigText(event.target.value)}
								placeholder={"[Interface]\nPrivateKey = ...\nAddress = ...\n\n[Peer]\nPublicKey = ...\nEndpoint = ..."}
							/>
							<FormHelperText>
								{t("pages.xray.mullvad.configHelp")}
							</FormHelperText>
						</FormControl>
						<Button
							leftIcon={<ArrowDownTrayIcon width={16} />}
							alignSelf="flex-start"
							isDisabled={!configText.trim()}
							onClick={fillFromConfig}
						>
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
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								<FormControl>
									<FormLabel>{t("pages.xray.mullvad.country")}</FormLabel>
									<Select
										value={country}
										options={countryOptions}
										placeholder={t("pages.xray.mullvad.chooseCountry")}
										onChange={(event) => selectCountry(event.target.value)}
									/>
								</FormControl>
								<FormControl isDisabled={!country}>
									<FormLabel>{t("pages.xray.mullvad.server")}</FormLabel>
									<Select
										value={serverName}
										options={serverOptions}
										placeholder={t("pages.xray.mullvad.chooseServer")}
										isDisabled={!country}
										onChange={(event) => selectServer(event.target.value)}
									/>
									<HStack spacing={2} mt={2}>
										<Button
											size="xs"
											leftIcon={<SignalIcon width={14} />}
											isDisabled={!canPing || !serverName || pinging}
											onClick={() => void pingServers([serverName])}
										>
											{t("pages.xray.mullvad.ping")}
										</Button>
										<Button
											size="xs"
											leftIcon={<SignalIcon width={14} />}
											isDisabled={!canPing || !country || pinging}
											isLoading={pinging}
											onClick={() => void pingServers(countryServerNames)}
										>
											{t("pages.xray.mullvad.pingAll")}
										</Button>
									</HStack>
									{!canPing && (
										<FormHelperText>
											{t("pages.xray.mullvad.pingNeedsNode")}
										</FormHelperText>
									)}
								</FormControl>
							</SimpleGrid>
						)}
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
							<FormControl>
								<FormLabel>{t("inbounds.wireguard.privateKey")}</FormLabel>
								<Input
									dir="ltr"
									fontFamily="mono"
									value={form.privateKey}
									onChange={(event) =>
										updateFormField("privateKey", event.target.value)
									}
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.outbound.address")}</FormLabel>
								<Input
									dir="ltr"
									fontFamily="mono"
									value={form.address}
									onChange={(event) =>
										updateFormField("address", event.target.value)
									}
									placeholder="10.64.0.2/32, fc00:bbbb:bbbb:bb01::1:1/128"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.mullvad.serverPublicKey")}</FormLabel>
								<Input
									dir="ltr"
									fontFamily="mono"
									value={form.publicKey}
									onChange={(event) =>
										updateFormField("publicKey", event.target.value)
									}
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.warp.endpoint")}</FormLabel>
								<Input
									dir="ltr"
									fontFamily="mono"
									value={form.endpoint}
									onChange={(event) =>
										updateFormField("endpoint", event.target.value)
									}
									placeholder="192.0.2.10:51820"
								/>
							</FormControl>
						</SimpleGrid>
					</VStack>
				</XrayModalBody>
				<XrayModalFooter>
					<Button variant="ghost" onClick={onClose}>
						{t("close")}
					</Button>
					<Button
						leftIcon={<ArrowPathIcon width={16} />}
						isDisabled={!tag.trim() || tagTaken || !isMullvadFormValid(form)}
						onClick={saveOutbound}
						colorScheme="primary"
					>
						{editingIndex >= 0
							? t("pages.xray.nord.updateOutbound")
							: t("pages.xray.outbound.addOutbound")}
					</Button>
					{editingIndex >= 0 && (
						<Button colorScheme="red" variant="outline" onClick={deleteOutbound}>
							{t("delete")}
						</Button>
					)}
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
