import {
	Accordion,
	AccordionButton,
	AccordionIcon,
	AccordionItem,
	AccordionPanel,
	Alert,
	AlertDescription,
	AlertDialog,
	AlertDialogBody,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertIcon,
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	CardHeader,
	Checkbox,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	Grid,
	GridItem,
	HStack,
	IconButton,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Radio,
	RadioGroup,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Table,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	useDisclosure,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowDownIcon,
	ArrowPathIcon,
	ArrowUpIcon,
	EyeIcon,
	PencilSquareIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { Input } from "components/Input";
import { useAdminsStore } from "contexts/AdminsContext";
import {
	fetchInbounds,
	type Inbounds,
	useDashboard,
} from "contexts/DashboardContext";
import { useHosts } from "contexts/HostsContext";
import { useServicesStore } from "contexts/ServicesContext";
import { motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import type {
	ServiceCreatePayload,
	ServiceDeletePayload,
	ServiceDetail,
	ServiceHostAssignment,
	ServiceSummary,
} from "types/Service";
import { formatBytes } from "utils/formatByte";

type HostOption = {
	id: number;
	label: string;
	inboundTag: string;
	protocol: string;
	isDisabled: boolean;
};

type ServiceDialogProps = {
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (
		payload: ServiceCreatePayload,
		serviceId?: number,
	) => Promise<void>;
	isSaving: boolean;
	allHosts: HostOption[];
	allAdmins: { id: number; username: string }[];
	initialService?: ServiceDetail | null;
	inbounds: Inbounds;
	refreshInbounds: () => Promise<void>;
	refreshHosts: () => void;
};

const NO_SERVICE_OPTION_VALUE = "__no_service__";

const ServiceDialog: FC<ServiceDialogProps> = ({
	isOpen,
	onClose,
	onSubmit,
	isSaving,
	allHosts,
	allAdmins,
	initialService,
	inbounds,
	refreshInbounds,
	refreshHosts,
}) => {
	const { t } = useTranslation();
	const [name, setName] = useState(initialService?.name ?? "");
	const [description, setDescription] = useState(
		initialService?.description ?? "",
	);
	const [selectedAdmins, setSelectedAdmins] = useState<number[]>(
		initialService?.admin_ids ?? [],
	);
	const [selectedHosts, setSelectedHosts] = useState<number[]>(
		initialService?.hosts.map((host) => host.id) ?? [],
	);
	const [adminSearch, setAdminSearch] = useState("");
	const [hostSearch, setHostSearch] = useState("");
	const [hoveredHost, setHoveredHost] = useState<number | null>(null);
	const [autoInboundBusy, setAutoInboundBusy] = useState(false);
	const toast = useToast();

	const autoInboundTag = initialService?.id
		? `setservice-${initialService.id}`
		: null;

	const autoInboundExists = useMemo(() => {
		if (!autoInboundTag) {
			return false;
		}
		for (const inboundList of inbounds.values()) {
			if (inboundList.some((inbound) => inbound.tag === autoInboundTag)) {
				return true;
			}
		}
		return false;
	}, [autoInboundTag, inbounds]);

	useEffect(() => {
		if (isOpen) {
			setName(initialService?.name ?? "");
			setDescription(initialService?.description ?? "");
			setSelectedAdmins(initialService?.admin_ids ?? []);
			setSelectedHosts(initialService?.hosts.map((host) => host.id) ?? []);
			setAdminSearch("");
			setHostSearch("");
			setAutoInboundBusy(false);
		}
	}, [isOpen, initialService]);

	const hostMap = useMemo(() => {
		return new Map(allHosts.map((host) => [host.id, host]));
	}, [allHosts]);

	const availableHosts = useMemo(() => {
		return allHosts.filter(
			(host) => !selectedHosts.includes(host.id) && !host.isDisabled,
		);
	}, [allHosts, selectedHosts]);

	const filteredAvailableHosts = useMemo(() => {
		const query = hostSearch.trim().toLowerCase();
		if (!query) {
			return availableHosts;
		}
		return availableHosts.filter((host) => {
			const label = host.label.toLowerCase();
			const inboundTag = host.inboundTag.toLowerCase();
			const protocol = host.protocol.toLowerCase();
			return (
				label.includes(query) ||
				inboundTag.includes(query) ||
				protocol.includes(query)
			);
		});
	}, [availableHosts, hostSearch]);

	const filteredAdmins = useMemo(() => {
		const query = adminSearch.trim().toLowerCase();
		if (!query) {
			return allAdmins;
		}
		return allAdmins.filter((admin) =>
			admin.username.toLowerCase().includes(query),
		);
	}, [adminSearch, allAdmins]);

	const selectedAdminsSet = useMemo(
		() => new Set(selectedAdmins),
		[selectedAdmins],
	);

	const handleToggleAllAdmins = () => {
		const hasAllSelected =
			selectedAdmins.length === allAdmins.length && allAdmins.length > 0;
		setSelectedAdmins(hasAllSelected ? [] : allAdmins.map((admin) => admin.id));
	};

	const handleAdminToggle = (adminId: number) => {
		setSelectedAdmins((prev) =>
			prev.includes(adminId)
				? prev.filter((id) => id !== adminId)
				: [...prev, adminId],
		);
	};

	const handleHostToggle = (hostId: number) => {
		setSelectedHosts((prev) =>
			prev.includes(hostId)
				? prev.filter((id) => id !== hostId)
				: [...prev, hostId],
		);
	};

	const moveHost = (hostId: number, direction: "up" | "down") => {
		setSelectedHosts((prev) => {
			const index = prev.indexOf(hostId);
			if (index === -1) return prev;
			const swapWith = direction === "up" ? index - 1 : index + 1;
			if (swapWith < 0 || swapWith >= prev.length) {
				return prev;
			}
			const updated = [...prev];
			[updated[index], updated[swapWith]] = [updated[swapWith], updated[index]];
			return updated;
		});
	};

	const submit = async () => {
		if (!name.trim()) {
			toast({
				status: "warning",
				title: t(
					"services.validation.nameRequired",
					"Service name is required",
				),
			});
			return;
		}
		if (!selectedHosts.length) {
			toast({
				status: "warning",
				title: t(
					"services.validation.hostRequired",
					"Please select at least one host",
				),
			});
			return;
		}

		const assignments: ServiceHostAssignment[] = selectedHosts.map(
			(hostId, index) => ({
				host_id: hostId,
				sort: index,
			}),
		);

		await onSubmit(
			{
				name: name.trim(),
				description: description?.trim() || null,
				admin_ids: selectedAdmins,
				hosts: assignments,
			},
			initialService?.id,
		);
	};

	const handleCreateAutoInbound = async () => {
		if (!initialService?.id || autoInboundExists) {
			return;
		}
		setAutoInboundBusy(true);
		try {
			await fetch(`/v2/services/${initialService.id}/auto-inbound`, {
				method: "POST",
			});
			await refreshInbounds();
			refreshHosts();
			toast({
				status: "success",
				title: t("services.autoInbound.created", "Auto inbound created"),
			});
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t(
						"services.autoInbound.createFailed",
						"Failed to create auto inbound",
					),
			});
		} finally {
			setAutoInboundBusy(false);
		}
	};

	const handleDeleteAutoInbound = async () => {
		if (!initialService?.id || !autoInboundExists) {
			return;
		}
		setAutoInboundBusy(true);
		try {
			await fetch(`/v2/services/${initialService.id}/auto-inbound`, {
				method: "DELETE",
			});
			await refreshInbounds();
			refreshHosts();
			toast({
				status: "success",
				title: t("services.autoInbound.deleted", "Auto inbound removed"),
			});
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t(
						"services.autoInbound.deleteFailed",
						"Failed to delete auto inbound",
					),
			});
		} finally {
			setAutoInboundBusy(false);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="5xl">
			<ModalOverlay />
			<ModalContent>
				<ModalHeader>
					{initialService
						? t("services.editTitle", "Edit Service")
						: t("services.createTitle", "Create Service")}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<Stack spacing={6}>
						<HStack spacing={4}>
							<Input
								label={t("services.fields.name", "Name")}
								value={name}
								onChange={(event) => setName(event.target.value)}
								maxLength={128}
								isRequired
							/>
							<Input
								label={t("services.fields.description", "Description")}
								value={description ?? ""}
								onChange={(event) => setDescription(event.target.value)}
								maxLength={256}
							/>
						</HStack>
						<Box>
							<Text fontWeight="medium" mb={2}>
								{t("services.fields.admins", "Admins")}
							</Text>
							<Stack spacing={3}>
								<Checkbox
									isChecked={
										selectedAdmins.length === allAdmins.length &&
										allAdmins.length > 0
									}
									onChange={handleToggleAllAdmins}
									isDisabled={allAdmins.length === 0}
								>
									{t("services.selectAllAdmins", "Select all admins")}
								</Checkbox>
								<Input
									value={adminSearch}
									onChange={(event) => setAdminSearch(event.target.value)}
									placeholder={t("services.searchAdmins", "Search admins")}
									size="sm"
									clearable
								/>
								<VStack
									align="stretch"
									spacing={2}
									maxH="200px"
									overflowY="auto"
									borderWidth="1px"
									borderRadius="md"
									p={3}
								>
									{allAdmins.length === 0 ? (
										<Text fontSize="sm" color="gray.500">
											{t("services.noAdminsFound", "No admins available")}
										</Text>
									) : filteredAdmins.length === 0 ? (
										<Text fontSize="sm" color="gray.500">
											{t(
												"services.noAdminsMatching",
												"No admins match your search",
											)}
										</Text>
									) : (
										filteredAdmins.map((admin) => {
											const isSelected = selectedAdminsSet.has(admin.id);
											return (
												<Box
													key={admin.id}
													borderWidth="1px"
													borderRadius="md"
													px={3}
													py={2}
													borderColor={isSelected ? "primary.400" : "gray.200"}
													bg={isSelected ? "primary.50" : "transparent"}
													_hover={{
														borderColor: "primary.300",
														cursor: "pointer",
													}}
													_dark={{
														borderColor: isSelected
															? "primary.300"
															: "gray.600",
														bg: isSelected ? "gray.700" : "transparent",
													}}
													transition="all 0.1s ease-in-out"
													onClick={() => handleAdminToggle(admin.id)}
													onKeyDown={(event) => {
														if (event.key === "Enter" || event.key === " ") {
															event.preventDefault();
															handleAdminToggle(admin.id);
														}
													}}
													role="button"
													tabIndex={0}
												>
													<Flex align="center" justify="space-between">
														<Text fontWeight="medium">{admin.username}</Text>
														{isSelected && (
															<Badge colorScheme="primary">
																{t("services.selected", "Selected")}
															</Badge>
														)}
													</Flex>
												</Box>
											);
										})
									)}
								</VStack>
							</Stack>
							<Text fontSize="sm" color="gray.500" mt={1}>
								{t(
									"services.adminHint",
									"Selected admins can create users for this service",
								)}
							</Text>
						</Box>
						<Box>
							<Text fontWeight="medium" mb={2}>
								{t("services.autoInbound.title", "Service inbound")}
								<Box as="span" ml={2} fontSize="xs" color="orange.500">
									{t("common.comingSoon", "Coming soon")}
								</Box>
							</Text>
							<Stack spacing={3} borderWidth="1px" borderRadius="md" p={4}>
								<Flex align="center" justify="space-between" gap={3}>
									<Box>
										<Text fontSize="sm" color="gray.500">
											{t("services.autoInbound.tagLabel", "Inbound tag")}
										</Text>
										<Text fontFamily="mono" fontSize="sm">
											{autoInboundTag ??
												t(
													"services.autoInbound.pendingTag",
													"Save the service to generate the tag",
												)}
										</Text>
									</Box>
									<Badge colorScheme={autoInboundExists ? "green" : "gray"}>
										{autoInboundExists
											? t("services.autoInbound.statusCreated", "Created")
											: t("services.autoInbound.statusMissing", "Not created")}
									</Badge>
								</Flex>
								<HStack spacing={2} flexWrap="wrap">
									<Button
										size="sm"
										onClick={handleCreateAutoInbound}
										isDisabled={
											true ||
											!initialService?.id ||
											autoInboundExists ||
											autoInboundBusy
										}
										isLoading={autoInboundBusy}
									>
										{t("services.autoInbound.create", "Create inbound")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										colorScheme="red"
										onClick={handleDeleteAutoInbound}
										isDisabled={
											true ||
											!initialService?.id ||
											!autoInboundExists ||
											autoInboundBusy
										}
										isLoading={autoInboundBusy}
									>
										{t("services.autoInbound.delete", "Delete inbound")}
									</Button>
								</HStack>
								<Text fontSize="sm" color="gray.500">
									{t(
										"services.autoInbound.helper",
										"Use this inbound as the only selection to auto-assign the service. It uses Shadowsocks defaults and should stay without hosts.",
									)}
								</Text>
								<Text fontSize="sm" color="orange.500">
									{t("common.comingSoon", "Coming soon")}
								</Text>
								{!initialService?.id && (
									<Text fontSize="sm" color="gray.500">
										{t(
											"services.autoInbound.saveFirst",
											"Save the service first to enable this option.",
										)}
									</Text>
								)}
							</Stack>
						</Box>
						<Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={4}>
							<GridItem>
								<Card variant="outline" h="full">
									<CardHeader>
										<Text fontWeight="semibold">
											{t("services.availableHosts", "Available Hosts")}
										</Text>
									</CardHeader>
									<CardBody>
										<Stack spacing={3}>
											<Input
												value={hostSearch}
												onChange={(event) => setHostSearch(event.target.value)}
												placeholder={t("services.searchHosts", "Search hosts")}
												size="sm"
												clearable
											/>
											<VStack
												align="stretch"
												spacing={2}
												maxH="300px"
												overflowY="auto"
											>
												{availableHosts.length === 0 ? (
													<Text fontSize="sm" color="gray.500">
														{t(
															"services.noHostsLeft",
															"All hosts are selected",
														)}
													</Text>
												) : filteredAvailableHosts.length === 0 ? (
													<Text fontSize="sm" color="gray.500">
														{t(
															"services.noHostsMatching",
															"No hosts match your search",
														)}
													</Text>
												) : (
													filteredAvailableHosts.map((host) => (
														<Box
															key={host.id}
															borderWidth="1px"
															borderRadius="md"
															px={3}
															py={2}
															borderColor={
																hoveredHost === host.id
																	? "primary.400"
																	: "gray.200"
															}
															_hover={{
																borderColor: "primary.300",
																cursor: "pointer",
															}}
															onMouseEnter={() => setHoveredHost(host.id)}
															onMouseLeave={() => setHoveredHost(null)}
															onClick={() => handleHostToggle(host.id)}
														>
															<Text fontWeight="medium">{host.label}</Text>
															<Text fontSize="sm" color="gray.500">
																{host.protocol.toUpperCase()} -{" "}
																{host.inboundTag}
															</Text>
														</Box>
													))
												)}
											</VStack>
										</Stack>
									</CardBody>
								</Card>
							</GridItem>
							<GridItem>
								<Card variant="outline" h="full">
									<CardHeader>
										<Text fontWeight="semibold">
											{t("services.selectedHosts", "Selected Hosts")}
										</Text>
									</CardHeader>
									<CardBody>
										<VStack
											align="stretch"
											spacing={2}
											maxH="300px"
											overflowY="auto"
										>
											{selectedHosts.length === 0 && (
												<Text fontSize="sm" color="gray.500">
													{t(
														"services.noHostsSelected",
														"Choose hosts from the left list",
													)}
												</Text>
											)}
											{selectedHosts.map((hostId, index) => {
												const host = hostMap.get(hostId);
												if (!host) return null;
												return (
													<motion.div layout key={hostId}>
														<Flex
															align="center"
															justify="space-between"
															borderWidth="1px"
															borderRadius="md"
															px={3}
															py={2}
															gap={3}
														>
															<Box>
																<HStack spacing={2} align="center">
																	<Text fontWeight="medium">{host.label}</Text>
																	{host.isDisabled && (
																		<Badge colorScheme="red">
																			{t("services.hostDisabled", "Disabled")}
																		</Badge>
																	)}
																</HStack>
																<Text fontSize="sm" color="gray.500">
																	{host.protocol.toUpperCase()} -{" "}
																	{host.inboundTag}
																</Text>
															</Box>
															<HStack spacing={1}>
																<Tooltip
																	label={t("services.moveUp", "Move up")}
																>
																	<IconButton
																		aria-label="Move up"
																		size="sm"
																		variant="ghost"
																		icon={<ArrowUpIcon width={16} />}
																		onClick={() => moveHost(hostId, "up")}
																		isDisabled={index === 0}
																	/>
																</Tooltip>
																<Tooltip
																	label={t("services.moveDown", "Move down")}
																>
																	<IconButton
																		aria-label="Move down"
																		size="sm"
																		variant="ghost"
																		icon={<ArrowDownIcon width={16} />}
																		onClick={() => moveHost(hostId, "down")}
																		isDisabled={
																			index === selectedHosts.length - 1
																		}
																	/>
																</Tooltip>
																<Tooltip
																	label={t(
																		"services.removeHost",
																		"Remove host",
																	)}
																>
																	<IconButton
																		aria-label="Remove"
																		size="sm"
																		variant="ghost"
																		icon={<TrashIcon width={16} />}
																		onClick={() => handleHostToggle(hostId)}
																	/>
																</Tooltip>
															</HStack>
														</Flex>
													</motion.div>
												);
											})}
										</VStack>
									</CardBody>
								</Card>
							</GridItem>
						</Grid>
					</Stack>
				</ModalBody>
				<ModalFooter>
					<HStack justify="flex-end" w="full">
						<Button onClick={onClose}>{t("cancel")}</Button>
						<Button colorScheme="primary" onClick={submit} isLoading={isSaving}>
							{initialService ? t("saveChanges") : t("create")}
						</Button>
					</HStack>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

const ServicesPage: FC = () => {
	const { t, i18n } = useTranslation();
	const _isRTL = i18n.language === "fa";
	const toast = useToast();
	const { userData, getUserIsSuccess } = useGetUser();
	const canManageServices =
		getUserIsSuccess && Boolean(userData.permissions?.sections.services);
	const servicesStore = useServicesStore();
	const adminStore = useAdminsStore();
	const hostsStore = useHosts();
	const { inbounds, refetchUsers } = useDashboard();

	const dialogDisclosure = useDisclosure();
	const [editingService, setEditingService] = useState<ServiceDetail | null>(
		null,
	);

	useEffect(() => {
		if (!getUserIsSuccess || !canManageServices) {
			return;
		}
		servicesStore.fetchServices();
		adminStore.fetchAdmins({ limit: 500, offset: 0 });
		fetchInbounds();
		hostsStore.fetchHosts();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		getUserIsSuccess,
		canManageServices,
		adminStore.fetchAdmins,
		hostsStore.fetchHosts,
		servicesStore.fetchServices,
	]);

	const adminOptions = useMemo(() => {
		return adminStore.admins
			.slice()
			.sort((a, b) => a.username.localeCompare(b.username))
			.map((admin) => ({
				id: admin.id!,
				username: admin.username,
			}));
	}, [adminStore.admins]);

	const hostOptions: HostOption[] = useMemo(() => {
		const options: HostOption[] = [];
		for (const [tag, hosts] of Object.entries(hostsStore.hosts)) {
			const inbound =
				Array.from(inbounds.values())
					.flat()
					.find((inbound) => inbound.tag === tag) ?? null;
			const protocol = inbound?.protocol ?? "unknown";
			hosts.forEach((host) => {
				if (host.id == null) {
					return;
				}
				options.push({
					id: host.id,
					label: host.remark,
					inboundTag: tag,
					protocol,
					isDisabled: Boolean(host.is_disabled),
				});
			});
		}
		return options;
	}, [hostsStore.hosts, inbounds]);

	const openCreateDialog = () => {
		setEditingService(null);
		dialogDisclosure.onOpen();
	};

	const openEditDialog = async (serviceId: number) => {
		try {
			const detail = await servicesStore.fetchServiceDetail(serviceId);
			setEditingService(detail);
			dialogDisclosure.onOpen();
		} catch (_error) {
			toast({
				status: "error",
				title: t("services.fetchFailed", "Unable to fetch service details"),
			});
		}
	};

	const handleSubmit = async (
		payload: ServiceCreatePayload,
		serviceId?: number,
	) => {
		try {
			if (serviceId) {
				await servicesStore.updateService(serviceId, payload);
				toast({
					status: "success",
					title: t("services.updated", "Service updated"),
				});
			} else {
				await servicesStore.createService(payload);
				toast({
					status: "success",
					title: t("services.created", "Service created"),
				});
			}
			refetchUsers(true);
			dialogDisclosure.onClose();
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t("services.saveFailed", "Failed to save service"),
			});
		}
	};

	const beginDeleteService = async (serviceId: number) => {
		try {
			const detail = await servicesStore.fetchServiceDetail(serviceId);
			setServicePendingDelete(detail);
			openDeleteDialog();
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t("services.deleteFailed", "Unable to delete service"),
			});
		}
	};

	const handleResetUsage = async (serviceId: number) => {
		try {
			await servicesStore.resetServiceUsage(serviceId);
			toast({
				status: "success",
				title: t("services.resetSuccess", "Usage reset"),
			});
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t("services.resetFailed", "Failed to reset usage"),
			});
		}
	};

	const [resetServiceId, setResetServiceId] = useState<number | null>(null);
	const [isResetting, setIsResetting] = useState(false);
	const {
		isOpen: isResetDialogOpen,
		onOpen: openResetDialog,
		onClose: closeResetDialog,
	} = useDisclosure();
	const resetCancelRef = useRef<HTMLButtonElement | null>(null);

	const openResetConfirmation = (serviceId: number) => {
		setResetServiceId(serviceId);
		openResetDialog();
	};

	const confirmResetUsage = async () => {
		if (resetServiceId == null) {
			return;
		}
		setIsResetting(true);
		try {
			await handleResetUsage(resetServiceId);
		} finally {
			setIsResetting(false);
			closeResetDialog();
		}
	};

	const resetTargetName =
		resetServiceId != null
			? servicesStore.services.find((service) => service.id === resetServiceId)
					?.name
			: undefined;

	const handleCloseDeleteDialog = () => {
		setServicePendingDelete(null);
		closeDeleteDialog();
	};

	const confirmDeleteService = async () => {
		if (!servicePendingDelete) {
			return;
		}
		const payload: ServiceDeletePayload = {
			mode: servicePendingDelete.user_count ? deleteMode : "delete_users",
			unlink_admins: unlinkAdmins,
			target_service_id: null,
		};
		if (payload.mode === "transfer_users") {
			payload.target_service_id = targetServiceId ?? null;
		}
		setIsDeleting(true);
		try {
			await servicesStore.deleteService(servicePendingDelete.id, payload);
			toast({
				status: "success",
				title: t("services.deleted", "Service removed"),
			});
			refetchUsers(true);
			handleCloseDeleteDialog();
		} catch (error: any) {
			toast({
				status: "error",
				title:
					error?.data?.detail ??
					t("services.deleteFailed", "Unable to delete service"),
			});
		} finally {
			setIsDeleting(false);
		}
	};

	const [servicePendingDelete, setServicePendingDelete] =
		useState<ServiceDetail | null>(null);
	const [deleteMode, setDeleteMode] = useState<
		"delete_users" | "transfer_users"
	>("transfer_users");
	const [unlinkAdmins, setUnlinkAdmins] = useState(false);
	const [targetServiceId, setTargetServiceId] = useState<number | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const {
		isOpen: isDeleteDialogOpen,
		onOpen: openDeleteDialog,
		onClose: closeDeleteDialog,
	} = useDisclosure();

	const otherServices = useMemo(() => {
		if (!servicePendingDelete) {
			return servicesStore.services;
		}
		return servicesStore.services.filter(
			(service) => service.id !== servicePendingDelete.id,
		);
	}, [servicePendingDelete, servicesStore.services]);

	useEffect(() => {
		if (servicePendingDelete) {
			const hasUsers = servicePendingDelete.user_count > 0;
			setDeleteMode(hasUsers ? "transfer_users" : "delete_users");
			setUnlinkAdmins(servicePendingDelete.admin_ids.length > 0);
			setTargetServiceId(null);
		}
	}, [servicePendingDelete]);

	useEffect(() => {
		if (deleteMode === "delete_users") {
			setTargetServiceId(null);
		}
	}, [deleteMode]);

	const renderServiceAccordionItem = (service: ServiceSummary) => (
		<AccordionItem
			key={`service-accordion-${service.id}`}
			borderWidth="1px"
			borderRadius="lg"
			borderColor="gray.200"
			_dark={{ borderColor: "whiteAlpha.200", bg: "gray.800" }}
			mb={2}
		>
			{({ isExpanded }) => (
				<>
					<AccordionButton
						px={4}
						py={3}
						display="flex"
						alignItems="flex-start"
						gap={3}
					>
						<Box flex="1" textAlign="left">
							<Text fontWeight="semibold">
								{t("services.columns.id", "ID")} {service.id} {service.name}
							</Text>
							{service.description && (
								<Text
									fontSize="sm"
									color="gray.500"
									_dark={{ color: "gray.300" }}
									noOfLines={isExpanded ? 3 : 1}
									mt={1}
								>
									{service.description}
								</Text>
							)}
						</Box>
						<VStack spacing={1} align="flex-end" fontSize="xs" color="gray.500">
							<HStack spacing={1}>
								<Text fontWeight="medium">
									{t("services.columns.hosts", "Hosts")}:
								</Text>
								<Text
									fontWeight="semibold"
									color="gray.700"
									_dark={{ color: "gray.200" }}
								>
									{service.host_count}
									{!service.has_hosts && (
										<Badge colorScheme="red" ml={2}>
											Broken
										</Badge>
									)}
								</Text>
							</HStack>
							<HStack spacing={1}>
								<Text fontWeight="medium">
									{t("services.columns.users", "Users")}:
								</Text>
								<Text
									fontWeight="semibold"
									color="gray.700"
									_dark={{ color: "gray.200" }}
								>
									{service.user_count}
								</Text>
							</HStack>
						</VStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pt={0} pb={4}>
						<Stack spacing={4}>
							<SimpleGrid columns={2} spacing={3}>
								<Box>
									<Text
										fontSize="xs"
										textTransform="uppercase"
										color="gray.500"
									>
										{t("services.columns.usage", "Usage")}
									</Text>
									<Text fontWeight="semibold">
										{formatBytes(service.used_traffic)}
									</Text>
								</Box>
								<Box>
									<Text
										fontSize="xs"
										textTransform="uppercase"
										color="gray.500"
									>
										{t("services.columns.lifetime", "Lifetime")}
									</Text>
									<Text fontWeight="semibold">
										{formatBytes(service.lifetime_used_traffic)}
									</Text>
								</Box>
							</SimpleGrid>
							<Stack spacing={2}>
								<Text fontSize="xs" textTransform="uppercase" color="gray.500">
									{t("services.actions", "Actions")}
								</Text>
								<HStack spacing={2} flexWrap="wrap">
									<Tooltip label={t("services.view", "View")}>
										<IconButton
											aria-label="View"
											icon={<EyeIcon width={18} />}
											size="sm"
											variant="outline"
											onClick={(event) => {
												event.stopPropagation();
												servicesStore.fetchServiceDetail(service.id);
											}}
										/>
									</Tooltip>
									<Tooltip label={t("services.edit", "Edit")}>
										<IconButton
											aria-label="Edit"
											icon={<PencilSquareIcon width={18} />}
											size="sm"
											variant="outline"
											onClick={(event) => {
												event.stopPropagation();
												openEditDialog(service.id);
											}}
											isDisabled={!canManageServices}
										/>
									</Tooltip>
									<Tooltip label={t("services.resetUsage", "Reset usage")}>
										<IconButton
											aria-label="Reset usage"
											icon={<ArrowPathIcon width={18} />}
											size="sm"
											variant="outline"
											onClick={(event) => {
												event.stopPropagation();
												openResetConfirmation(service.id);
											}}
											isDisabled={!canManageServices}
										/>
									</Tooltip>
									<Tooltip label={t("services.delete", "Delete")}>
										<IconButton
											aria-label="Delete"
											icon={<TrashIcon width={18} />}
											size="sm"
											variant="outline"
											colorScheme="red"
											onClick={(event) => {
												event.stopPropagation();
												beginDeleteService(service.id);
											}}
											isDisabled={!canManageServices}
										/>
									</Tooltip>
								</HStack>
							</Stack>
						</Stack>
					</AccordionPanel>
				</>
			)}
		</AccordionItem>
	);

	const renderServiceRow = (service: ServiceSummary, index: number) => (
		<Tr
			key={service.id}
			className={
				index === servicesStore.services.length - 1 ? "last-row" : undefined
			}
		>
			<Td>{service.id}</Td>
			<Td>
				<VStack align="start" spacing={0}>
					<Text fontWeight="semibold">{service.name}</Text>
					{service.description && (
						<Text fontSize="sm" color="gray.500">
							{service.description}
						</Text>
					)}
				</VStack>
			</Td>
			<Td>
				{service.host_count}
				{!service.has_hosts && (
					<Badge colorScheme="red" ml={2}>
						Broken
					</Badge>
				)}
			</Td>
			<Td>{service.user_count}</Td>
			<Td>{formatBytes(service.used_traffic)}</Td>
			<Td>{formatBytes(service.lifetime_used_traffic)}</Td>
			<Td>
				<HStack spacing={2}>
					<Tooltip label={t("services.view", "View")}>
						<IconButton
							aria-label="View"
							icon={<EyeIcon width={18} />}
							size="sm"
							variant="ghost"
							onClick={() => servicesStore.fetchServiceDetail(service.id)}
						/>
					</Tooltip>
					{canManageServices && (
						<>
							<Tooltip label={t("services.edit", "Edit")}>
								<IconButton
									aria-label="Edit"
									icon={<PencilSquareIcon width={18} />}
									size="sm"
									variant="ghost"
									onClick={() => openEditDialog(service.id)}
								/>
							</Tooltip>
							<Tooltip label={t("services.resetUsage", "Reset usage")}>
								<IconButton
									aria-label="Reset usage"
									icon={<ArrowPathIcon width={18} />}
									size="sm"
									variant="ghost"
									onClick={() => openResetConfirmation(service.id)}
								/>
							</Tooltip>
							<Tooltip label={t("services.delete", "Delete")}>
								<IconButton
									aria-label="Delete"
									icon={<TrashIcon width={18} />}
									size="sm"
									variant="ghost"
									onClick={() => beginDeleteService(service.id)}
								/>
							</Tooltip>
						</>
					)}
				</HStack>
			</Td>
		</Tr>
	);

	const selectedService = servicesStore.serviceDetail;

	if (!getUserIsSuccess) {
		return (
			<Flex justify="center" align="center" h="full" py={10}>
				<Spinner />
			</Flex>
		);
	}

	if (!canManageServices) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("services.title", "Services")}
				</Text>
				<Text fontSize="sm" color="gray.500">
					{t(
						"services.noPermission",
						"You do not have permission to view this section.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<Flex
				direction={{ base: "column", md: "row" }}
				justify="space-between"
				align={{ base: "flex-start", md: "center" }}
				gap={{ base: 3, md: 0 }}
			>
				<Box>
					<Text as="h1" fontSize="2xl" fontWeight="semibold">
						{t("services.title", "Services")}
					</Text>
					<Text fontSize="sm" color="gray.500">
						{t(
							"services.subtitle",
							"Group hosts, assign admins, and monitor usage per service.",
						)}
					</Text>
				</Box>
				{canManageServices && (
					<Button
						leftIcon={<PlusIcon width={18} />}
						colorScheme="primary"
						onClick={openCreateDialog}
						size="sm"
						alignSelf={{ base: "flex-start", md: "center" }}
						w={{ base: "auto", md: "auto" }}
						px={{ base: 4, md: 5 }}
					>
						{t("services.addService", "New Service")}
					</Button>
				)}
			</Flex>
			<Card variant="outline">
				<CardBody>
					{servicesStore.isLoading ? (
						<Flex justify="center" py={10}>
							<Spinner />
						</Flex>
					) : (
						<>
							<Accordion allowToggle display={{ base: "block", md: "none" }}>
								{servicesStore.services.map(renderServiceAccordionItem)}
							</Accordion>
							<Box display={{ base: "none", md: "block" }} overflowX="auto">
								<Table variant="simple">
									<Thead>
										<Tr>
											<Th>{t("services.columns.id", "ID")}</Th>
											<Th>{t("services.columns.name", "Name")}</Th>
											<Th>{t("services.columns.hosts", "Hosts")}</Th>
											<Th>{t("services.columns.users", "Users")}</Th>
											<Th>{t("services.columns.usage", "Usage")}</Th>
											<Th>{t("services.columns.lifetime", "Lifetime")}</Th>
											<Th>{t("services.columns.actions", "Actions")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{servicesStore.services.map((service, index) =>
											renderServiceRow(service, index),
										)}
									</Tbody>
								</Table>
							</Box>
						</>
					)}
				</CardBody>
			</Card>

			{selectedService && (
				<Card variant="outline">
					<CardHeader>
						<Flex justify="space-between" align="center">
							<Box>
								<Text fontWeight="semibold">{selectedService.name}</Text>
								{selectedService.description && (
									<Text fontSize="sm" color="gray.500">
										{selectedService.description}
									</Text>
								)}
							</Box>
							<Badge colorScheme="primary">
								{t("services.usersCount", "{{count}} users", {
									count: selectedService.user_count,
								})}
							</Badge>
						</Flex>
					</CardHeader>
					<CardBody>
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
							<Box>
								<Text fontWeight="medium" mb={2}>
									{t("services.admins", "Admins")}
								</Text>
								<Stack spacing={2}>
									{selectedService.admins.length === 0 ? (
										<Text fontSize="sm" color="gray.500">
											{t("services.noAdmins", "No admins assigned")}
										</Text>
									) : (
										selectedService.admins.map((link) => (
											<Flex
												key={link.id}
												justify="space-between"
												borderWidth="1px"
												borderRadius="md"
												px={3}
												py={2}
											>
												<Text fontWeight="medium">{link.username}</Text>
												<Text fontSize="sm" color="gray.500">
													{formatBytes(link.used_traffic)} /{" "}
													{formatBytes(link.lifetime_used_traffic)}
												</Text>
											</Flex>
										))
									)}
								</Stack>
							</Box>
							<Box>
								<Text fontWeight="medium" mb={2}>
									{t("services.hosts", "Hosts")}
								</Text>
								<Stack spacing={2}>
									{selectedService.hosts.map((host) => (
										<Flex
											key={host.id}
											borderWidth="1px"
											borderRadius="md"
											px={3}
											py={2}
											justify="space-between"
											align="center"
										>
											<Box>
												<Text fontWeight="medium">{host.remark}</Text>
												<Text fontSize="sm" color="gray.500">
													{host.inbound_protocol.toUpperCase()} -{" "}
													{host.inbound_tag}
												</Text>
											</Box>
											<Badge colorScheme="gray">#{host.sort + 1}</Badge>
										</Flex>
									))}
								</Stack>
							</Box>
						</SimpleGrid>
					</CardBody>
				</Card>
			)}

			<AlertDialog
				isOpen={isResetDialogOpen}
				leastDestructiveRef={resetCancelRef}
				onClose={closeResetDialog}
				isCentered
				motionPreset="slideInBottom"
			>
				<AlertDialogOverlay>
					<AlertDialogContent mx={{ base: 4, sm: 0 }}>
						<AlertDialogHeader fontSize="lg" fontWeight="bold">
							{t("services.resetUsage", "Reset usage")}
						</AlertDialogHeader>
						<AlertDialogBody>
							{t("services.resetUsageConfirm", "Reset usage for {{name}}?", {
								name:
									resetTargetName ?? t("services.thisService", "this service"),
							})}
						</AlertDialogBody>
						<AlertDialogFooter>
							<Button ref={resetCancelRef} onClick={closeResetDialog}>
								{t("cancel", "Cancel")}
							</Button>
							<Button
								colorScheme="primary"
								ml={3}
								onClick={confirmResetUsage}
								isLoading={isResetting}
							>
								{t("services.resetUsage", "Reset usage")}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>

			<Modal
				isOpen={isDeleteDialogOpen}
				onClose={handleCloseDeleteDialog}
				size="lg"
			>
				<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(6px)" />
				<ModalContent>
					<ModalHeader>
						{t("services.deleteDialogTitle", "Delete Service")}
						{servicePendingDelete ? ` – ${servicePendingDelete.name}` : ""}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						{servicePendingDelete ? (
							<VStack align="stretch" spacing={4}>
								<Text>
									{t("services.deleteDialogDescription", {
										name: servicePendingDelete.name,
									})}
								</Text>
								{servicePendingDelete.admin_ids.length > 0 ? (
									<Checkbox
										isChecked={unlinkAdmins}
										onChange={(event) => setUnlinkAdmins(event.target.checked)}
									>
										{t(
											"services.unlinkAdminsOption",
											"Unlink all admins automatically",
										)}
									</Checkbox>
								) : (
									<Text fontSize="sm" color="gray.500">
										{t(
											"services.noAdminsLinked",
											"No admins are currently linked.",
										)}
									</Text>
								)}
								{servicePendingDelete.user_count > 0 ? (
									<VStack align="stretch" spacing={3}>
										<Text fontWeight="semibold">
											{t("services.userDeletePrompt", {
												count: servicePendingDelete.user_count,
											})}
										</Text>
										<RadioGroup
											value={deleteMode}
											onChange={(value) =>
												setDeleteMode(
													value as "delete_users" | "transfer_users",
												)
											}
										>
											<Stack align="flex-start" spacing={2}>
												<Radio value="delete_users">
													{t(
														"services.deleteUsersOption",
														"Delete linked users with the service",
													)}
												</Radio>
												<Radio value="transfer_users">
													{t(
														"services.transferUsersOption",
														"Keep linked users (move them to No service or another service)",
													)}
												</Radio>
											</Stack>
										</RadioGroup>
										{deleteMode === "transfer_users" && (
											<FormControl>
												<FormLabel>
													{t("services.selectTargetService", "Target service")}
												</FormLabel>
												<Select
													placeholder={t(
														"services.selectServicePlaceholder",
														"Select a service",
													)}
													value={
														targetServiceId === null
															? NO_SERVICE_OPTION_VALUE
															: (targetServiceId?.toString() ??
																NO_SERVICE_OPTION_VALUE)
													}
													onChange={(
														event: React.ChangeEvent<HTMLSelectElement>,
													) => {
														const value = event.target.value;
														if (!value || value === NO_SERVICE_OPTION_VALUE) {
															setTargetServiceId(null);
															return;
														}
														setTargetServiceId(Number(value));
													}}
												>
													<option value={NO_SERVICE_OPTION_VALUE}>
														{t(
															"services.noServiceTargetOption",
															"Move users to No service (default)",
														)}
													</option>
													{otherServices.map((service) => (
														<option key={service.id} value={service.id}>
															{service.name}
														</option>
													))}
												</Select>
												<FormHelperText>
													{t(
														"services.transferUsersHint",
														"Users will be unassigned from this service by default. Select another service if you want to move them elsewhere.",
													)}
												</FormHelperText>
											</FormControl>
										)}
									</VStack>
								) : (
									<Alert status="info" borderRadius="md">
										<AlertIcon />
										<AlertDescription>
											{t(
												"services.noUsersLinked",
												"This service has no linked users.",
											)}
										</AlertDescription>
									</Alert>
								)}
							</VStack>
						) : (
							<Text>{t("services.loading", "Loading...")}</Text>
						)}
					</ModalBody>
					<ModalFooter gap={3}>
						<Button variant="ghost" onClick={handleCloseDeleteDialog}>
							{t("cancel", "Cancel")}
						</Button>
						<Button
							colorScheme="red"
							onClick={confirmDeleteService}
							isLoading={isDeleting}
							isDisabled={!servicePendingDelete}
						>
							{t("services.delete", "Delete")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>

			<ServiceDialog
				isOpen={dialogDisclosure.isOpen}
				onClose={dialogDisclosure.onClose}
				onSubmit={handleSubmit}
				isSaving={servicesStore.isSaving}
				allHosts={hostOptions}
				allAdmins={adminOptions}
				initialService={editingService ?? undefined}
				inbounds={inbounds}
				refreshInbounds={fetchInbounds}
				refreshHosts={hostsStore.fetchHosts}
			/>
		</VStack>
	);
};

export default ServicesPage;
