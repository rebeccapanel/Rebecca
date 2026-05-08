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
	Checkbox,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
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
	useColorModeValue,
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
import { ChartBox } from "components/common/ChartBox";
import { Input } from "components/Input";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "components/xray/XrayDialog";
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
import type { Admin, AdminPermissions } from "types/Admin";
import { AdminTrafficLimitMode } from "types/Admin";
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
const GB_IN_BYTES = 1024 * 1024 * 1024;
const MB_IN_BYTES = 1024 * 1024;

const formatGigabytes = (
	bytes?: number | null,
	unlimitedLabel = "Unlimited",
) => {
	const value = Number(bytes ?? 0);
	if (!Number.isFinite(value) || value <= 0) {
		return unlimitedLabel;
	}
	const gb = value / GB_IN_BYTES;
	return `${Number.isInteger(gb) ? gb : Number(gb.toFixed(2))} GB`;
};

const MetricTile: FC<{
	label: string;
	value: string | number;
	helper?: string;
	accentColor?: string;
}> = ({ label, value, helper, accentColor = "primary.400" }) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");

	return (
		<Box
			position="relative"
			overflow="hidden"
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			p={3}
		>
			<Box
				position="absolute"
				insetInlineStart={0}
				top={0}
				bottom={0}
				w="3px"
				bg={accentColor}
			/>
			<Text fontSize="xs" color={labelColor} fontWeight="semibold">
				{label}
			</Text>
			<Text mt={1} fontWeight="semibold" fontSize="lg" lineHeight="1.2">
				{value}
			</Text>
			{helper && (
				<Text mt={1} fontSize="xs" color={labelColor}>
					{helper}
				</Text>
			)}
		</Box>
	);
};

const adminCanDeleteUsers = (admin?: Admin) =>
	Boolean(admin?.permissions?.users?.delete);

const withDeleteUserPermission = (permissions: AdminPermissions) => ({
	...permissions,
	users: {
		...permissions.users,
		delete: true,
	},
});

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
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const subtleBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const selectedBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const labelColor = useColorModeValue("gray.500", "gray.400");
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
		<Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent
				mx="3"
				sx={{
					".service-dialog-section .chakra-form-control": {
						display: "block",
						gridTemplateColumns: "none",
					},
					".service-dialog-list": {
						borderColor,
						bg: subtleBg,
					},
				}}
			>
				<XrayModalHeader>
					{initialService
						? t("services.editTitle", "Edit Service")
						: t("services.createTitle", "Create Service")}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<Stack spacing={4}>
						<Box className="xray-dialog-section service-dialog-section">
							<Text fontSize="sm" fontWeight="semibold" mb={3}>
								{t("services.basicInfo", "Basic information")}
							</Text>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
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
							</SimpleGrid>
						</Box>

						<Box className="xray-dialog-section service-dialog-section">
							<Flex justify="space-between" align="center" gap={3} mb={3}>
								<Text fontSize="sm" fontWeight="semibold">
									{t("services.fields.admins", "Admins")}
								</Text>
								<Badge borderRadius="md" variant="subtle" colorScheme="primary">
									{selectedAdmins.length} / {allAdmins.length}
								</Badge>
							</Flex>
							<Stack spacing={2}>
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
									className="service-dialog-list"
									align="stretch"
									spacing={1.5}
									maxH="170px"
									overflowY="auto"
									borderWidth="1px"
									borderRadius="md"
									p={2}
								>
									{allAdmins.length === 0 ? (
										<Text fontSize="sm" color={labelColor}>
											{t("services.noAdminsFound", "No admins available")}
										</Text>
									) : filteredAdmins.length === 0 ? (
										<Text fontSize="sm" color={labelColor}>
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
													px={2.5}
													py={2}
													borderColor={isSelected ? "primary.400" : borderColor}
													bg={isSelected ? selectedBg : "transparent"}
													_hover={{
														borderColor: "primary.300",
														cursor: "pointer",
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
													<Flex align="center" justify="space-between" gap={3}>
														<Text fontWeight="medium" noOfLines={1}>
															{admin.username}
														</Text>
														{isSelected && (
															<Badge colorScheme="primary" borderRadius="md">
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
							<Text fontSize="xs" color={labelColor} mt={2}>
								{t(
									"services.adminHint",
									"Selected admins can create users for this service",
								)}
							</Text>
						</Box>

						<Box className="xray-dialog-section service-dialog-section">
							<Flex
								justify="space-between"
								align={{ base: "flex-start", md: "center" }}
								gap={3}
								flexWrap="wrap"
								mb={3}
							>
								<Box minW={0}>
									<Text fontSize="sm" fontWeight="semibold">
										{t("services.autoInbound.title", "Service inbound")}
									</Text>
									<Text
										fontFamily="mono"
										fontSize="xs"
										color={labelColor}
										mt={1}
									>
										{autoInboundTag ??
											t(
												"services.autoInbound.pendingTag",
												"Save the service to generate the tag",
											)}
									</Text>
								</Box>
								<Badge
									borderRadius="md"
									colorScheme={autoInboundExists ? "green" : "gray"}
								>
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
										!initialService?.id || autoInboundExists || autoInboundBusy
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
										!initialService?.id || !autoInboundExists || autoInboundBusy
									}
									isLoading={autoInboundBusy}
								>
									{t("services.autoInbound.delete", "Delete inbound")}
								</Button>
							</HStack>
							<Text fontSize="xs" color={labelColor} mt={2}>
								{t(
									"services.autoInbound.helper",
									"Use this inbound as the only selection to auto-assign the service. It uses Shadowsocks defaults and should stay without hosts.",
								)}
							</Text>
						</Box>

						<SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
							<Box className="xray-dialog-section service-dialog-section">
								<Text fontSize="sm" fontWeight="semibold" mb={3}>
									{t("services.availableHosts", "Available Hosts")}
								</Text>
								<Stack spacing={2}>
									<Input
										value={hostSearch}
										onChange={(event) => setHostSearch(event.target.value)}
										placeholder={t("services.searchHosts", "Search hosts")}
										size="sm"
										clearable
									/>
									<VStack
										className="service-dialog-list"
										align="stretch"
										spacing={1.5}
										maxH="260px"
										overflowY="auto"
										borderWidth="1px"
										borderRadius="md"
										p={2}
									>
										{availableHosts.length === 0 ? (
											<Text fontSize="sm" color={labelColor}>
												{t("services.noHostsLeft", "All hosts are selected")}
											</Text>
										) : filteredAvailableHosts.length === 0 ? (
											<Text fontSize="sm" color={labelColor}>
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
													px={2.5}
													py={2}
													borderColor={
														hoveredHost === host.id
															? "primary.400"
															: borderColor
													}
													_hover={{
														borderColor: "primary.300",
														cursor: "pointer",
													}}
													onMouseEnter={() => setHoveredHost(host.id)}
													onMouseLeave={() => setHoveredHost(null)}
													onClick={() => handleHostToggle(host.id)}
												>
													<Text fontWeight="medium" noOfLines={1}>
														{host.label}
													</Text>
													<Text fontSize="xs" color={labelColor}>
														{host.protocol.toUpperCase()} - {host.inboundTag}
													</Text>
												</Box>
											))
										)}
									</VStack>
								</Stack>
							</Box>

							<Box className="xray-dialog-section service-dialog-section">
								<Flex justify="space-between" align="center" gap={3} mb={3}>
									<Text fontSize="sm" fontWeight="semibold">
										{t("services.selectedHosts", "Selected Hosts")}
									</Text>
									<Badge borderRadius="md" variant="subtle">
										{selectedHosts.length}
									</Badge>
								</Flex>
								<VStack
									className="service-dialog-list"
									align="stretch"
									spacing={1.5}
									maxH="300px"
									overflowY="auto"
									borderWidth="1px"
									borderRadius="md"
									p={2}
								>
									{selectedHosts.length === 0 && (
										<Text fontSize="sm" color={labelColor}>
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
													borderColor={borderColor}
													px={2.5}
													py={2}
													gap={3}
												>
													<Box minW={0}>
														<HStack spacing={2} align="center">
															<Text fontWeight="medium" noOfLines={1}>
																{host.label}
															</Text>
															{host.isDisabled && (
																<Badge colorScheme="red" borderRadius="md">
																	{t("services.hostDisabled", "Disabled")}
																</Badge>
															)}
														</HStack>
														<Text fontSize="xs" color={labelColor}>
															{host.protocol.toUpperCase()} - {host.inboundTag}
														</Text>
													</Box>
													<HStack spacing={1} flexShrink={0}>
														<Tooltip label={t("services.moveUp", "Move up")}>
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
																isDisabled={index === selectedHosts.length - 1}
															/>
														</Tooltip>
														<Tooltip
															label={t("services.removeHost", "Remove host")}
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
							</Box>
						</SimpleGrid>
					</Stack>
				</XrayModalBody>
				<XrayModalFooter>
					<Button variant="ghost" onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button colorScheme="primary" onClick={submit} isLoading={isSaving}>
						{initialService ? t("saveChanges") : t("create")}
					</Button>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};

const ServicesPage: FC = () => {
	const { t, i18n } = useTranslation();
	const _isRTL = i18n.language === "fa";
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const panelBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const cardBg = useColorModeValue("white", "whiteAlpha.50");
	const labelColor = useColorModeValue("gray.500", "gray.400");
	const tableHeadBg = useColorModeValue("gray.50", "whiteAlpha.100");
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
	const [savingAdminLimitId, setSavingAdminLimitId] = useState<number | null>(
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
	const servicesSummary = useMemo(
		() =>
			servicesStore.services.reduce(
				(summary, service) => ({
					totalHosts: summary.totalHosts + Number(service.host_count || 0),
					totalUsers: summary.totalUsers + Number(service.user_count || 0),
					totalUsage: summary.totalUsage + Number(service.used_traffic || 0),
					lifetimeUsage:
						summary.lifetimeUsage + Number(service.lifetime_used_traffic || 0),
					brokenServices: summary.brokenServices + (service.has_hosts ? 0 : 1),
				}),
				{
					totalHosts: 0,
					totalUsers: 0,
					totalUsage: 0,
					lifetimeUsage: 0,
					brokenServices: 0,
				},
			),
		[servicesStore.services],
	);

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
			borderRadius="md"
			borderColor={borderColor}
			bg={cardBg}
			overflow="hidden"
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
							<HStack spacing={2} flexWrap="wrap">
								<Badge borderRadius="md" variant="subtle">
									#{service.id}
								</Badge>
								<Text fontWeight="semibold">{service.name}</Text>
								{!service.has_hosts && (
									<Badge colorScheme="red" borderRadius="md">
										Broken
									</Badge>
								)}
							</HStack>
							{service.description && (
								<Text
									fontSize="sm"
									color={labelColor}
									noOfLines={isExpanded ? 3 : 1}
									mt={1}
								>
									{service.description}
								</Text>
							)}
						</Box>
						<VStack
							spacing={1}
							align="flex-end"
							fontSize="xs"
							color={labelColor}
						>
							<HStack spacing={1}>
								<Text fontWeight="medium">
									{t("services.columns.hosts", "Hosts")}:
								</Text>
								<Text fontWeight="semibold">{service.host_count}</Text>
							</HStack>
							<HStack spacing={1}>
								<Text fontWeight="medium">
									{t("services.columns.users", "Users")}:
								</Text>
								<Text fontWeight="semibold">{service.user_count}</Text>
							</HStack>
						</VStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pt={0} pb={4}>
						<Stack spacing={4}>
							<SimpleGrid columns={2} spacing={3}>
								<MetricTile
									label={t("services.columns.usage", "Usage")}
									value={formatBytes(service.used_traffic)}
								/>
								<MetricTile
									label={t("services.columns.lifetime", "Lifetime")}
									value={formatBytes(service.lifetime_used_traffic)}
									accentColor="purple.400"
								/>
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
			_hover={{ bg: panelBg }}
		>
			<Td>
				<Badge borderRadius="md" variant="subtle">
					#{service.id}
				</Badge>
			</Td>
			<Td>
				<VStack align="start" spacing={0}>
					<Text fontWeight="semibold">{service.name}</Text>
					{service.description && (
						<Text fontSize="sm" color={labelColor} noOfLines={1}>
							{service.description}
						</Text>
					)}
				</VStack>
			</Td>
			<Td>
				<Text as="span" fontWeight="semibold">
					{service.host_count}
				</Text>
				{!service.has_hosts && (
					<Badge colorScheme="red" ml={2} borderRadius="md">
						Broken
					</Badge>
				)}
			</Td>
			<Td fontWeight="semibold">{service.user_count}</Td>
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

	const saveServiceAdminLimit = async (
		adminId: number,
		payload: {
			traffic_limit_mode?: AdminTrafficLimitMode;
			data_limit?: number | null;
			show_user_traffic?: boolean;
			users_limit?: number | null;
			delete_user_usage_limit_enabled?: boolean;
			delete_user_usage_limit?: number | null;
		},
	) => {
		if (!selectedService) return;
		setSavingAdminLimitId(adminId);
		try {
			if (payload.delete_user_usage_limit_enabled === true) {
				const targetAdmin = adminStore.admins.find(
					(item) => item.id === adminId,
				);
				if (targetAdmin && !adminCanDeleteUsers(targetAdmin)) {
					await adminStore.updateAdmin(targetAdmin.username, {
						permissions: withDeleteUserPermission(targetAdmin.permissions),
					});
				}
			}
			await servicesStore.updateServiceAdminLimits(
				selectedService.id,
				adminId,
				payload,
			);
			if (payload.delete_user_usage_limit_enabled === true) {
				await servicesStore.fetchServiceDetail(selectedService.id);
			}
		} catch (error) {
			toast({
				status: "error",
				title: t("services.adminLimitSaveFailed", "Unable to save limits"),
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setSavingAdminLimitId(null);
		}
	};

	const resetServiceDeletedUsersUsage = async (link: {
		id: number;
		username: string;
	}) => {
		if (!selectedService) return;
		setSavingAdminLimitId(link.id);
		try {
			await adminStore.resetDeletedUsersUsage(
				link.username,
				selectedService.id,
			);
			await servicesStore.fetchServiceDetail(selectedService.id);
			toast({
				status: "success",
				title: t("admins.resetDeletedUsageSuccess", "Deleted-user usage reset"),
			});
		} catch (error) {
			toast({
				status: "error",
				title: t(
					"admins.resetDeletedUsageFailed",
					"Unable to reset deleted-user usage",
				),
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setSavingAdminLimitId(null);
		}
	};

	if (!getUserIsSuccess) {
		return (
			<Flex justify="center" align="center" h="full" py={10}>
				<Spinner />
			</Flex>
		);
	}

	if (!canManageServices) {
		return (
			<VStack
				spacing={3}
				align="start"
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				p={4}
			>
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("services.title", "Services")}
				</Text>
				<Text fontSize="sm" color={labelColor}>
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
			<Box
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				p={{ base: 3, md: 4 }}
			>
				<Flex
					direction={{ base: "column", md: "row" }}
					justify="space-between"
					align={{ base: "flex-start", md: "center" }}
					gap={3}
				>
					<Box minW={0}>
						<Text as="h1" fontSize="2xl" fontWeight="semibold">
							{t("services.title", "Services")}
						</Text>
						<Text fontSize="sm" color={labelColor}>
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
						>
							{t("services.addService", "New Service")}
						</Button>
					)}
				</Flex>
			</Box>

			<SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} spacing={4}>
				<MetricTile
					label={t("services.title", "Services")}
					value={servicesStore.services.length}
				/>
				<MetricTile
					label={t("services.columns.hosts", "Hosts")}
					value={servicesSummary.totalHosts}
					accentColor="green.400"
				/>
				<MetricTile
					label={t("services.columns.users", "Users")}
					value={servicesSummary.totalUsers}
					accentColor="orange.400"
				/>
				<MetricTile
					label={t("services.columns.usage", "Usage")}
					value={formatBytes(servicesSummary.totalUsage)}
					accentColor="blue.400"
				/>
				<MetricTile
					label={t("services.columns.lifetime", "Lifetime")}
					value={formatBytes(servicesSummary.lifetimeUsage)}
					helper={
						servicesSummary.brokenServices > 0
							? t("services.brokenCount", "{{count}} broken", {
									count: servicesSummary.brokenServices,
								})
							: undefined
					}
					accentColor="purple.400"
				/>
			</SimpleGrid>

			<ChartBox title={t("services.title", "Services")}>
				{servicesStore.isLoading ? (
					<Flex justify="center" py={10}>
						<Spinner />
					</Flex>
				) : servicesStore.services.length === 0 ? (
					<Box
						borderWidth="1px"
						borderColor={borderColor}
						borderRadius="md"
						bg={panelBg}
						p={5}
						textAlign="center"
					>
						<Text fontWeight="semibold">
							{t("services.noServicesAvailable", "No services available")}
						</Text>
						<Text fontSize="sm" color={labelColor} mt={1}>
							{t(
								"services.emptyHint",
								"Create a service to group hosts and admins.",
							)}
						</Text>
					</Box>
				) : (
					<>
						<Accordion allowToggle display={{ base: "block", md: "none" }}>
							{servicesStore.services.map(renderServiceAccordionItem)}
						</Accordion>
						<Box
							display={{ base: "none", md: "block" }}
							overflowX="auto"
							borderWidth="1px"
							borderColor={borderColor}
							borderRadius="md"
						>
							<Table variant="simple" size="sm">
								<Thead bg={tableHeadBg}>
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
			</ChartBox>

			{selectedService && (
				<ChartBox
					title={
						<Flex
							justify="space-between"
							align="center"
							gap={3}
							flexWrap="wrap"
						>
							<Box minW={0}>
								<Text fontWeight="semibold" noOfLines={1}>
									{selectedService.name}
								</Text>
								{selectedService.description && (
									<Text fontSize="sm" color={labelColor} noOfLines={2}>
										{selectedService.description}
									</Text>
								)}
							</Box>
							<Badge colorScheme="primary" borderRadius="md">
								{t("services.usersCount", "{{count}} users", {
									count: selectedService.user_count,
								})}
							</Badge>
						</Flex>
					}
				>
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
										<Stack
											key={link.id}
											borderWidth="1px"
											borderColor={borderColor}
											borderRadius="md"
											bg={cardBg}
											px={3}
											py={2}
											spacing={3}
										>
											<Flex justify="space-between" gap={3}>
												<Text fontWeight="medium">{link.username}</Text>
												<Text fontSize="sm" color={labelColor}>
													{link.traffic_limit_mode ===
													AdminTrafficLimitMode.CreatedTraffic
														? formatBytes(link.created_traffic)
														: formatBytes(link.used_traffic)}{" "}
													/{" "}
													{formatGigabytes(
														link.data_limit,
														t("common.unlimited", "Unlimited"),
													)}
												</Text>
											</Flex>
											<Flex
												justify="space-between"
												align="center"
												gap={3}
												flexWrap="wrap"
											>
												<Text fontSize="xs" color="gray.500">
													{t("admins.deletedUsersUsage", "Deleted-user usage")}:{" "}
													{formatBytes(link.deleted_users_usage)}
												</Text>
												{link.deleted_users_usage > 0 && (
													<Button
														size="xs"
														variant="ghost"
														leftIcon={<ArrowPathIcon width={14} />}
														isLoading={savingAdminLimitId === link.id}
														onClick={() => resetServiceDeletedUsersUsage(link)}
													>
														{t(
															"admins.resetDeletedUsage",
															"Reset deleted-user usage",
														)}
													</Button>
												)}
											</Flex>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={2}>
												<FormControl>
													<FormLabel fontSize="xs">
														{t("admins.trafficMode", "Traffic mode")}
													</FormLabel>
													<Select
														size="sm"
														value={link.traffic_limit_mode}
														isDisabled={savingAdminLimitId === link.id}
														onChange={(event) =>
															saveServiceAdminLimit(link.id, {
																traffic_limit_mode: event.target
																	.value as AdminTrafficLimitMode,
															})
														}
													>
														<option value={AdminTrafficLimitMode.UsedTraffic}>
															{t("admins.usedTraffic", "Used traffic")}
														</option>
														<option
															value={AdminTrafficLimitMode.CreatedTraffic}
														>
															{t("admins.createdTraffic", "Created traffic")}
														</option>
													</Select>
												</FormControl>
												<FormControl>
													<FormLabel fontSize="xs">
														{t("admins.dataLimit", "Data Limit (GB)")}
													</FormLabel>
													<Input
														size="sm"
														type="number"
														inputMode="numeric"
														defaultValue={
															link.data_limit
																? Math.floor(link.data_limit / GB_IN_BYTES)
																: ""
														}
														isDisabled={savingAdminLimitId === link.id}
														onBlur={(event) =>
															saveServiceAdminLimit(link.id, {
																data_limit: event.target.value
																	? Number(event.target.value) * GB_IN_BYTES
																	: null,
															})
														}
													/>
												</FormControl>
												<FormControl>
													<FormLabel fontSize="xs">
														{t("admins.usersLimit", "Users Limit")}
													</FormLabel>
													<Input
														size="sm"
														type="number"
														inputMode="numeric"
														defaultValue={link.users_limit ?? ""}
														isDisabled={savingAdminLimitId === link.id}
														onBlur={(event) =>
															saveServiceAdminLimit(link.id, {
																users_limit: event.target.value
																	? Number(event.target.value)
																	: null,
															})
														}
													/>
												</FormControl>
												<FormControl>
													<FormLabel fontSize="xs">
														{t(
															"admins.deleteUserUsageLimit",
															"Max deletable user usage (MB)",
														)}
													</FormLabel>
													<Input
														size="sm"
														type="number"
														inputMode="numeric"
														defaultValue={
															link.delete_user_usage_limit
																? Math.floor(
																		link.delete_user_usage_limit / MB_IN_BYTES,
																	)
																: ""
														}
														isDisabled={savingAdminLimitId === link.id}
														onBlur={(event) =>
															saveServiceAdminLimit(link.id, {
																delete_user_usage_limit: event.target.value
																	? Number(event.target.value) * MB_IN_BYTES
																	: null,
															})
														}
													/>
												</FormControl>
											</SimpleGrid>
											<HStack spacing={4} flexWrap="wrap">
												<Checkbox
													isChecked={link.show_user_traffic}
													isDisabled={savingAdminLimitId === link.id}
													onChange={(event) =>
														saveServiceAdminLimit(link.id, {
															show_user_traffic: event.target.checked,
														})
													}
												>
													{t(
														"admins.showUserTraffic",
														"Admin can view user traffic",
													)}
												</Checkbox>
												<Checkbox
													isChecked={link.delete_user_usage_limit_enabled}
													isDisabled={savingAdminLimitId === link.id}
													onChange={(event) =>
														saveServiceAdminLimit(link.id, {
															delete_user_usage_limit_enabled:
																event.target.checked,
														})
													}
												>
													{t(
														"admins.deleteUserUsageCap",
														"Limit delete by user usage",
													)}
												</Checkbox>
											</HStack>
										</Stack>
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
										borderColor={borderColor}
										borderRadius="md"
										bg={cardBg}
										px={3}
										py={2}
										justify="space-between"
										align="center"
									>
										<Box>
											<Text fontWeight="medium">{host.remark}</Text>
											<Text fontSize="sm" color={labelColor}>
												{host.inbound_protocol.toUpperCase()} -{" "}
												{host.inbound_tag}
											</Text>
										</Box>
										<Badge colorScheme="gray" borderRadius="md">
											#{host.sort + 1}
										</Badge>
									</Flex>
								))}
							</Stack>
						</Box>
					</SimpleGrid>
				</ChartBox>
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
