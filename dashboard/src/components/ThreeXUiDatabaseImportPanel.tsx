import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Checkbox,
	Divider,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	Progress,
	Select,
	SimpleGrid,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { FileDropzone } from "components/common/FileDropzone";
import { NumericInput } from "components/common/NumericInput";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "react-query";
import {
	getThreeXUiImportJob,
	previewThreeXUiDatabase,
	startThreeXUiImport,
	type ThreeXUiImportJobResponse,
	type ThreeXUiImportRequest,
	type ThreeXUiInboundImportConfig,
	type ThreeXUiInboundPreview,
	type ThreeXUiPreviewResponse,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";

type InboundConfigState = {
	importEnabled: boolean;
	adminId: string;
	serviceId: string;
	usernameConflictMode: "rename" | "skip" | "overwrite";
	expireOverrideMode: "none" | "add" | "replace";
	expireDays: string;
	trafficOverrideMode: "none" | "add" | "replace";
	trafficGigabytes: string;
};

const GIB = 1024 ** 3;

const buildDefaultInboundConfig = (
	preview: ThreeXUiPreviewResponse,
): Record<number, InboundConfigState> => {
	const defaultAdminId = preview.admins[0]?.id?.toString() ?? "";
	return Object.fromEntries(
		preview.inbounds.map((inbound) => [
			inbound.inbound_id,
			{
				importEnabled: true,
				adminId: defaultAdminId,
				serviceId: "",
				usernameConflictMode: "rename",
				expireOverrideMode: "none",
				expireDays: "",
				trafficOverrideMode: "none",
				trafficGigabytes: "",
			},
		]),
	);
};

const isJobRunning = (job?: ThreeXUiImportJobResponse | null) =>
	job?.status === "pending" || job?.status === "running";

export const ThreeXUiDatabaseImportPanel = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<ThreeXUiPreviewResponse | null>(null);
	const [inboundConfigs, setInboundConfigs] = useState<
		Record<number, InboundConfigState>
	>({});
	const [sourceConflictMode, setSourceConflictMode] = useState<
		"keep_first" | "skip_all"
	>("keep_first");
	const [existingConflictMode, setExistingConflictMode] = useState<
		"skip" | "overwrite"
	>("overwrite");
	const [activeJobId, setActiveJobId] = useState<string | null>(null);

	useEffect(() => {
		if (!preview) {
			setInboundConfigs({});
			return;
		}
		setInboundConfigs(buildDefaultInboundConfig(preview));
		setSourceConflictMode("keep_first");
		setExistingConflictMode("overwrite");
		setActiveJobId(null);
	}, [preview]);

	const previewMutation = useMutation(previewThreeXUiDatabase, {
		onSuccess: (payload) => {
			setPreview(payload);
			generateSuccessMessage(
				t("settings.database.previewReady", "3x-ui database preview is ready."),
				toast,
			);
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const importMutation = useMutation(startThreeXUiImport, {
		onSuccess: (job) => {
			setActiveJobId(job.job_id);
			generateSuccessMessage(
				t("settings.database.importStarted", "Import job started."),
				toast,
			);
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const jobQuery = useQuery(
		["3xui-import-job", activeJobId],
		() => getThreeXUiImportJob(activeJobId as string),
		{
			enabled: Boolean(activeJobId),
			refetchInterval: (data) =>
				isJobRunning(data as ThreeXUiImportJobResponse | undefined)
					? 1500
					: false,
			refetchOnWindowFocus: false,
		},
	);

	const job = jobQuery.data;
	const running =
		previewMutation.isLoading || importMutation.isLoading || isJobRunning(job);

	const canStartImport = useMemo(() => {
		if (!preview || preview.importable_clients === 0) {
			return false;
		}
		const enabledInbounds = preview.inbounds.filter(
			(inbound) => inboundConfigs[inbound.inbound_id]?.importEnabled,
		);
		if (enabledInbounds.length === 0) {
			return false;
		}
		return enabledInbounds.every((inbound) => {
			const config = inboundConfigs[inbound.inbound_id];
			return Boolean(config?.adminId);
		});
	}, [preview, inboundConfigs]);

	const updateInboundConfig = (
		inboundId: number,
		patch: Partial<InboundConfigState>,
	) => {
		setInboundConfigs((prev) => {
			const current = prev[inboundId];
			if (!current) {
				return prev;
			}
			const next = { ...current, ...patch };
			return { ...prev, [inboundId]: next };
		});
	};

	const servicesForInbound = (inbound: ThreeXUiInboundPreview) => {
		const config = inboundConfigs[inbound.inbound_id];
		if (!preview || !config?.adminId) {
			return [];
		}
		return preview.services.filter((service) => {
			if (!service.admin_ids.includes(Number(config.adminId))) {
				return false;
			}
			if (service.supported_protocols.length === 0) {
				return true;
			}
			return service.supported_protocols.includes(inbound.protocol);
		});
	};

	const handlePreview = () => {
		if (!selectedFile) {
			toast({
				status: "warning",
				title: t(
					"settings.database.fileRequired",
					"Select a 3x-ui SQLite database file first.",
				),
			});
			return;
		}
		previewMutation.mutate(selectedFile);
	};

	const buildImportPayload = (): ThreeXUiImportRequest | null => {
		if (!preview) {
			return null;
		}

		const inbounds: ThreeXUiInboundImportConfig[] = [];
		for (const inbound of preview.inbounds) {
			const config = inboundConfigs[inbound.inbound_id];
			if (!config?.importEnabled) {
				inbounds.push({
					inbound_id: inbound.inbound_id,
					import_enabled: false,
					admin_id: null,
					service_id: null,
					username_conflict_mode: "rename",
					expire_override_mode: "none",
					expire_override_seconds: null,
					traffic_override_mode: "none",
					traffic_override_bytes: null,
				});
				continue;
			}
			if (!config?.adminId) {
				toast({
					status: "warning",
					title: t(
						"settings.database.adminRequired",
						"Select an owner admin for every inbound before importing.",
					),
				});
				return null;
			}

			let expireOverrideSeconds: number | null = null;
			if (config.expireOverrideMode !== "none") {
				const daysValue = Number(config.expireDays);
				if (!Number.isFinite(daysValue) || daysValue < 0) {
					toast({
						status: "warning",
						title: t(
							"settings.database.invalidExpire",
							"Expire override must be a valid number of days.",
						),
					});
					return null;
				}
				expireOverrideSeconds = Math.round(daysValue * 86400);
			}

			let trafficOverrideBytes: number | null = null;
			if (config.trafficOverrideMode !== "none") {
				const gigabytesValue = Number(config.trafficGigabytes);
				if (!Number.isFinite(gigabytesValue) || gigabytesValue < 0) {
					toast({
						status: "warning",
						title: t(
							"settings.database.invalidTraffic",
							"Traffic override must be a valid number of gigabytes.",
						),
					});
					return null;
				}
				trafficOverrideBytes = Math.round(gigabytesValue * GIB);
			}

			inbounds.push({
				inbound_id: inbound.inbound_id,
				import_enabled: true,
				admin_id: Number(config.adminId),
				service_id: config.serviceId ? Number(config.serviceId) : null,
				username_conflict_mode: config.usernameConflictMode,
				expire_override_mode: config.expireOverrideMode,
				expire_override_seconds: expireOverrideSeconds,
				traffic_override_mode: config.trafficOverrideMode,
				traffic_override_bytes: trafficOverrideBytes,
			});
		}

		return {
			preview_id: preview.preview_id,
			inbounds,
			duplicate_subaddress_policy: {
				source_conflict_mode: sourceConflictMode,
				existing_conflict_mode: existingConflictMode,
			},
		};
	};

	const handleImport = () => {
		const payload = buildImportPayload();
		if (!payload) {
			return;
		}
		importMutation.mutate(payload);
	};

	return (
		<Stack spacing={6} align="stretch">
			<Text fontSize="sm" color="gray.500">
				{t(
					"settings.database.description",
					"Upload a 3x-ui SQLite database, preview supported inbounds and import users with per-inbound owner, service and conflict policies.",
				)}
			</Text>

			<Box borderWidth="1px" borderRadius="lg" p={4}>
				<Stack spacing={4}>
					<FormControl>
						<FormLabel>
							{t("settings.database.fileLabel", "3x-ui database file")}
						</FormLabel>
						<FileDropzone
							accept=".db,.sqlite,.sqlite3"
							selectedFile={selectedFile}
							title={t(
								"settings.database.dropTitle",
								"Drop 3x-ui database here",
							)}
							description={t(
								"settings.database.dropHint",
								"Drag a SQLite database file here or select it from your device.",
							)}
							emptyText={t("settings.database.selectFile", "Select file")}
							onFileSelect={setSelectedFile}
						/>
					</FormControl>
					<HStack justify="space-between" align="center" flexWrap="wrap">
						<Text fontSize="sm" color="gray.500">
							{t(
								"settings.database.previewHint",
								"Preview scans only VMess, VLESS and Trojan inbounds. Unsupported protocols stay untouched.",
							)}
						</Text>
						<Button
							leftIcon={<ArrowUpTrayIcon width={16} height={16} />}
							onClick={handlePreview}
							isLoading={previewMutation.isLoading}
						>
							{t("settings.database.previewAction", "Preview Database")}
						</Button>
					</HStack>
				</Stack>
			</Box>

			{preview ? (
				<Stack spacing={6} align="stretch">
					<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
						<Box borderWidth="1px" borderRadius="lg" p={4}>
							<Text fontSize="sm" color="gray.500">
								{t("settings.database.detectedInbounds", "Detected inbounds")}
							</Text>
							<Text fontSize="2xl" fontWeight="semibold">
								{preview.supported_inbounds}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"settings.database.detectedInboundsHint",
									"Supported inbounds ready for import",
								)}
							</Text>
						</Box>
						<Box borderWidth="1px" borderRadius="lg" p={4}>
							<Text fontSize="sm" color="gray.500">
								{t("settings.database.detectedUsers", "Importable users")}
							</Text>
							<Text fontSize="2xl" fontWeight="semibold">
								{preview.importable_clients}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"settings.database.detectedUsersHint",
									"Users parsed successfully from supported inbounds",
								)}
							</Text>
						</Box>
						<Box borderWidth="1px" borderRadius="lg" p={4}>
							<Text fontSize="sm" color="gray.500">
								{t("settings.database.skippedUsers", "Skipped during parsing")}
							</Text>
							<Text fontSize="2xl" fontWeight="semibold">
								{preview.skipped_unsupported + preview.skipped_invalid}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"settings.database.skippedUsersHint",
									"Unsupported or invalid clients are not imported",
								)}
							</Text>
						</Box>
					</SimpleGrid>

					{preview.skipped_unsupported > 0 || preview.skipped_invalid > 0 ? (
						<Alert status="warning" borderRadius="md">
							<AlertIcon />
							<Text fontSize="sm">
								{t(
									"settings.database.previewWarning",
									"Some clients were skipped while parsing.",
								)}{" "}
								{t(
									"settings.database.previewWarningCounts",
									"Unsupported: {{unsupported}}, Invalid: {{invalid}}",
									{
										unsupported: preview.skipped_unsupported,
										invalid: preview.skipped_invalid,
									},
								)}
							</Text>
						</Alert>
					) : null}

					<Box borderWidth="1px" borderRadius="lg" p={4}>
						<Stack spacing={4}>
							<Box>
								<Text fontWeight="semibold">
									{t(
										"settings.database.duplicateSubaddressTitle",
										"Global duplicate subaddress policy",
									)}
								</Text>
								<Text fontSize="sm" color="gray.500">
									{t(
										"settings.database.duplicateSubaddressHint",
										"Applies to every duplicate subaddress group found across the uploaded database.",
									)}
								</Text>
							</Box>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
								<FormControl>
									<FormLabel>
										{t(
											"settings.database.sourceDuplicates",
											"Source duplicate subaddresses",
										)}
									</FormLabel>
									<Select
										value={sourceConflictMode}
										onChange={(event) =>
											setSourceConflictMode(
												event.target.value as "keep_first" | "skip_all",
											)
										}
									>
										<option value="keep_first">
											{t(
												"settings.database.keepFirst",
												"Keep first and skip the rest",
											)}
										</option>
										<option value="skip_all">
											{t(
												"settings.database.skipAll",
												"Skip every conflicting source user",
											)}
										</option>
									</Select>
								</FormControl>
								<FormControl>
									<FormLabel>
										{t(
											"settings.database.existingDuplicates",
											"Existing Rebecca subaddress conflicts",
										)}
									</FormLabel>
									<Select
										value={existingConflictMode}
										onChange={(event) =>
											setExistingConflictMode(
												event.target.value as "skip" | "overwrite",
											)
										}
									>
										<option value="overwrite">
											{t(
												"settings.database.overwriteExisting",
												"Overwrite existing Rebecca user",
											)}
										</option>
										<option value="skip">
											{t(
												"settings.database.skipExisting",
												"Skip conflicting user",
											)}
										</option>
									</Select>
								</FormControl>
							</SimpleGrid>

							{preview.duplicate_subaddresses.length > 0 ? (
								<Stack spacing={3}>
									{preview.duplicate_subaddresses.map((group) => (
										<Box
											key={group.subadress}
											borderWidth="1px"
											borderRadius="md"
											p={3}
										>
											<HStack
												justify="space-between"
												align={{ base: "flex-start", md: "center" }}
												flexWrap="wrap"
											>
												<Text fontWeight="semibold">{group.subadress}</Text>
												<HStack>
													<Badge colorScheme="orange">
														{t(
															"settings.database.sourceCount",
															"Source: {{count}}",
															{ count: group.source_count },
														)}
													</Badge>
													{group.existing_users.length > 0 ? (
														<Badge colorScheme="red">
															{t(
																"settings.database.existingCount",
																"Existing: {{count}}",
																{ count: group.existing_users.length },
															)}
														</Badge>
													) : null}
												</HStack>
											</HStack>
											<Text fontSize="sm" color="gray.500" mt={2}>
												{group.occurrences
													.map(
														(occurrence) =>
															`${occurrence.inbound_remark} / ${occurrence.protocol} / ${occurrence.username}`,
													)
													.join(" | ")}
											</Text>
										</Box>
									))}
								</Stack>
							) : (
								<Text fontSize="sm" color="gray.500">
									{t(
										"settings.database.noDuplicateSubaddress",
										"No duplicate subaddress groups were detected.",
									)}
								</Text>
							)}
						</Stack>
					</Box>

					<Stack spacing={4}>
						{preview.inbounds.map((inbound) => {
							const config = inboundConfigs[inbound.inbound_id];
							const services = servicesForInbound(inbound);
							const importEnabled = config?.importEnabled !== false;
							const sourceParts = [
								inbound.source_port
									? t("settings.database.sourcePort", "Port: {{port}}", {
											port: inbound.source_port,
										})
									: null,
								inbound.source_tag
									? t("settings.database.sourceTag", "Tag: {{tag}}", {
											tag: inbound.source_tag,
										})
									: null,
								inbound.network
									? t(
											"settings.database.sourceNetwork",
											"Network: {{network}}",
											{
												network: inbound.network,
											},
										)
									: null,
								inbound.security
									? t(
											"settings.database.sourceSecurity",
											"Security: {{security}}",
											{ security: inbound.security },
										)
									: null,
							].filter(Boolean);
							return (
								<Box
									key={inbound.inbound_id}
									borderWidth="1px"
									borderRadius="lg"
									p={4}
								>
									<Stack spacing={4}>
										<HStack justify="space-between" flexWrap="wrap">
											<Box>
												<Text fontWeight="semibold">{inbound.remark}</Text>
												<Text fontSize="sm" color="gray.500">
													{t(
														"settings.database.inboundMeta",
														"Protocol: {{protocol}} | Parsed users: {{count}} / {{raw}}",
														{
															protocol: inbound.protocol,
															count: inbound.importable_client_count,
															raw: inbound.raw_client_count,
														},
													)}
												</Text>
												{sourceParts.length > 0 ? (
													<Text fontSize="sm" color="gray.500">
														{sourceParts.join(" | ")}
													</Text>
												) : null}
											</Box>
											<HStack>
												<Checkbox
													isChecked={importEnabled}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															importEnabled: event.target.checked,
														})
													}
												>
													{t("settings.database.importInbound", "Import")}
												</Checkbox>
												<Badge colorScheme={importEnabled ? "blue" : "gray"}>
													ID #{inbound.inbound_id}
												</Badge>
											</HStack>
										</HStack>

										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl
												isRequired={importEnabled}
												isDisabled={!importEnabled}
											>
												<FormLabel>
													{t("settings.database.ownerAdmin", "Owner admin")}
												</FormLabel>
												<Select
													value={config?.adminId ?? ""}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															adminId: event.target.value,
															serviceId: "",
														})
													}
												>
													<option value="">
														{t("settings.database.selectAdmin", "Select admin")}
													</option>
													{preview.admins.map((admin) => (
														<option key={admin.id} value={admin.id}>
															{admin.username}
														</option>
													))}
												</Select>
											</FormControl>
											<FormControl isDisabled={!importEnabled}>
												<FormLabel>
													{t(
														"settings.database.targetService",
														"Target service",
													)}
												</FormLabel>
												<Select
													value={config?.serviceId ?? ""}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															serviceId: event.target.value,
														})
													}
													isDisabled={!importEnabled || !config?.adminId}
												>
													<option value="">
														{t("settings.database.noService", "No service")}
													</option>
													{services.map((service) => (
														<option key={service.id} value={service.id}>
															{service.name}
														</option>
													))}
												</Select>
												<FormHelperText>
													{t(
														"settings.database.serviceHint",
														"Only services linked to the selected admin are shown. Leaving this empty imports users in no-service mode.",
													)}
												</FormHelperText>
											</FormControl>
										</SimpleGrid>

										<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
											<FormControl isDisabled={!importEnabled}>
												<FormLabel>
													{t(
														"settings.database.usernamePolicy",
														"Username conflict policy",
													)}
												</FormLabel>
												<Select
													value={config?.usernameConflictMode ?? "rename"}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															usernameConflictMode: event.target
																.value as InboundConfigState["usernameConflictMode"],
														})
													}
												>
													<option value="rename">
														{t(
															"settings.database.renameUsers",
															"Rename duplicates",
														)}
													</option>
													<option value="skip">
														{t(
															"settings.database.skipUsers",
															"Skip duplicates",
														)}
													</option>
													<option value="overwrite">
														{t(
															"settings.database.overwriteUsers",
															"Overwrite existing user",
														)}
													</option>
												</Select>
											</FormControl>
											<FormControl isDisabled={!importEnabled}>
												<FormLabel>
													{t(
														"settings.database.expireMode",
														"Expire override mode",
													)}
												</FormLabel>
												<Select
													value={config?.expireOverrideMode ?? "none"}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															expireOverrideMode: event.target
																.value as InboundConfigState["expireOverrideMode"],
														})
													}
												>
													<option value="none">
														{t("settings.database.noChange", "No change")}
													</option>
													<option value="add">
														{t("settings.database.addMode", "Add")}
													</option>
													<option value="replace">
														{t("settings.database.replaceMode", "Replace")}
													</option>
												</Select>
											</FormControl>
											<FormControl
												isDisabled={
													!importEnabled ||
													config?.expireOverrideMode === "none"
												}
											>
												<FormLabel>
													{t("settings.database.expireDays", "Expire days")}
												</FormLabel>
												<NumericInput
													min={0}
													step={1}
													value={config?.expireDays ?? ""}
													onChange={(value) =>
														updateInboundConfig(inbound.inbound_id, {
															expireDays: value,
														})
													}
												/>
											</FormControl>
										</SimpleGrid>

										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl isDisabled={!importEnabled}>
												<FormLabel>
													{t(
														"settings.database.trafficMode",
														"Traffic override mode",
													)}
												</FormLabel>
												<Select
													value={config?.trafficOverrideMode ?? "none"}
													onChange={(event) =>
														updateInboundConfig(inbound.inbound_id, {
															trafficOverrideMode: event.target
																.value as InboundConfigState["trafficOverrideMode"],
														})
													}
												>
													<option value="none">
														{t("settings.database.noChange", "No change")}
													</option>
													<option value="add">
														{t("settings.database.addMode", "Add")}
													</option>
													<option value="replace">
														{t("settings.database.replaceMode", "Replace")}
													</option>
												</Select>
											</FormControl>
											<FormControl
												isDisabled={
													!importEnabled ||
													config?.trafficOverrideMode === "none"
												}
											>
												<FormLabel>
													{t(
														"settings.database.trafficGigabytes",
														"Traffic gigabytes",
													)}
												</FormLabel>
												<NumericInput
													min={0}
													step={0.1}
													value={config?.trafficGigabytes ?? ""}
													onChange={(value) =>
														updateInboundConfig(inbound.inbound_id, {
															trafficGigabytes: value,
														})
													}
												/>
											</FormControl>
										</SimpleGrid>

										{inbound.username_conflicts.length > 0 ? (
											<Box
												borderWidth="1px"
												borderRadius="md"
												p={3}
												bg="orange.50"
												_dark={{ bg: "orange.900" }}
											>
												<Text fontWeight="medium" mb={2}>
													{t(
														"settings.database.usernameConflicts",
														"Detected username conflicts",
													)}
												</Text>
												<Stack spacing={2}>
													{inbound.username_conflicts.map((conflict) => (
														<Text key={conflict.username} fontSize="sm">
															{conflict.username}
															{conflict.source_count > 1
																? ` | ${t(
																		"settings.database.sourceDuplicatesShort",
																		"source duplicates: {{count}}",
																		{ count: conflict.source_count },
																	)}`
																: ""}
															{conflict.existing_usernames.length > 0
																? ` | ${t(
																		"settings.database.existingUsersShort",
																		"existing: {{users}}",
																		{
																			users:
																				conflict.existing_usernames.join(", "),
																		},
																	)}`
																: ""}
														</Text>
													))}
												</Stack>
											</Box>
										) : null}
									</Stack>
								</Box>
							);
						})}
					</Stack>

					<Divider />

					{job ? (
						<Box borderWidth="1px" borderRadius="lg" p={4}>
							<Stack spacing={4}>
								<Box>
									<Text fontWeight="semibold">
										{t("settings.database.jobStatus", "Import job status")}
									</Text>
									<Text fontSize="sm" color="gray.500">
										{job.message ||
											t(
												"settings.database.jobStatusHint",
												"The current import job progress is shown here.",
											)}
									</Text>
								</Box>
								<Progress
									value={
										job.progress_total > 0
											? (job.progress_current / job.progress_total) * 100
											: 0
									}
									borderRadius="full"
									size="sm"
									colorScheme={
										job.status === "failed"
											? "red"
											: job.status === "completed"
												? "green"
												: "blue"
									}
								/>
								<HStack justify="space-between" flexWrap="wrap">
									<Badge colorScheme="blue">{job.status}</Badge>
									<Text fontSize="sm" color="gray.500">
										{job.progress_current} / {job.progress_total}
									</Text>
								</HStack>
								{job.result ? (
									<SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
										<Box borderWidth="1px" borderRadius="md" p={3}>
											<Text fontSize="sm" color="gray.500">
												{t("settings.database.createdUsers", "Created")}
											</Text>
											<Text fontSize="xl" fontWeight="semibold">
												{job.result.created}
											</Text>
										</Box>
										<Box borderWidth="1px" borderRadius="md" p={3}>
											<Text fontSize="sm" color="gray.500">
												{t("settings.database.updatedUsers", "Updated")}
											</Text>
											<Text fontSize="xl" fontWeight="semibold">
												{job.result.updated}
											</Text>
										</Box>
										<Box borderWidth="1px" borderRadius="md" p={3}>
											<Text fontSize="sm" color="gray.500">
												{t("settings.database.skippedUsers", "Skipped")}
											</Text>
											<Text fontSize="xl" fontWeight="semibold">
												{job.result.skipped}
											</Text>
										</Box>
									</SimpleGrid>
								) : null}
								{job.result?.warnings?.length ? (
									<Alert
										status="warning"
										borderRadius="md"
										alignItems="flex-start"
									>
										<AlertIcon mt={1} />
										<Stack spacing={1}>
											<Text fontWeight="semibold">
												{t("settings.database.warnings", "Warnings")}
											</Text>
											{job.result.warnings.slice(0, 10).map((warning) => (
												<Text key={warning} fontSize="sm">
													{warning}
												</Text>
											))}
										</Stack>
									</Alert>
								) : null}
							</Stack>
						</Box>
					) : null}

					<HStack justify="flex-end">
						<Button
							onClick={handleImport}
							isDisabled={!canStartImport || running}
							isLoading={importMutation.isLoading}
						>
							{t("settings.database.importAction", "Import Users")}
						</Button>
					</HStack>
				</Stack>
			) : null}
		</Stack>
	);
};

export default ThreeXUiDatabaseImportPanel;
