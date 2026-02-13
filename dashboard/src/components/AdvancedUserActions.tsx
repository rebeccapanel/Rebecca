import {
	Alert,
	AlertIcon,
	Box,
	Button,
	Checkbox,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	NumberInput,
	NumberInputField,
	Select,
	Stack,
	Text,
	useBreakpointValue,
	useDisclosure,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminRole } from "types/Admin";
import type {
	AdvancedUserActionPayload,
	AdvancedUserActionScopeStatus,
	AdvancedUserActionStatus,
	AdvancedUserActionType,
} from "types/User";

const cleanupOptions: AdvancedUserActionStatus[] = ["expired", "limited"];
const scopeStatusOptions: AdvancedUserActionScopeStatus[] = [
	"active",
	"on_hold",
	"limited",
	"expired",
	"disabled",
];
type ServiceScopePayload = Partial<
	Pick<AdvancedUserActionPayload, "service_id" | "service_id_is_null">
>;

type OwnerSelection = "my_users" | "all_users" | `admin:${string}`;

const AdvancedUserActions = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { performBulkUserAction } = useDashboard();
	const { userData } = useGetUser();
	const { isOpen, onOpen, onClose } = useDisclosure();
	const [expireDays, setExpireDays] = useState("");
	const [trafficGb, setTrafficGb] = useState("");
	const [cleanupDays, setCleanupDays] = useState("");
	const [selectedStatuses, setSelectedStatuses] = useState<
		AdvancedUserActionStatus[]
	>(["expired", "limited"]);
	const [selectedScopeStatuses, setSelectedScopeStatuses] = useState<
		AdvancedUserActionScopeStatus[]
	>(["active"]);
	const [isExtending, setIsExtending] = useState(false);
	const [isReducing, setIsReducing] = useState(false);
	const [isIncreasingTraffic, setIsIncreasingTraffic] = useState(false);
	const [isDecreasingTraffic, setIsDecreasingTraffic] = useState(false);
	const [isCleaning, setIsCleaning] = useState(false);
	const [ownerSelection, setOwnerSelection] =
		useState<OwnerSelection>("my_users");
	const [selectedServiceValue, setSelectedServiceValue] = useState("");
	const [targetServiceValue, setTargetServiceValue] = useState("");
	const [isChangingService, setIsChangingService] = useState(false);
	const { admins: adminList, fetchAdmins } = useAdminsStore();
	const servicesStore = useServicesStore();

	const hasScopeSelect =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const canSeeServiceControls = hasScopeSelect;
	const canUseAdvanced = Boolean(
		userData.permissions?.users?.advanced_actions ?? true,
	);

	useEffect(() => {
		if (isOpen && hasScopeSelect) {
			fetchAdmins({ limit: 200, offset: 0 });
		}
		if (isOpen && servicesStore.services.length === 0) {
			servicesStore.fetchServices({ limit: 200, offset: 0 });
		}
	}, [fetchAdmins, hasScopeSelect, isOpen, servicesStore]);

	const resolveTargetAdminUsername = () => {
		if (!hasScopeSelect) {
			return userData.username;
		}
		if (ownerSelection === "all_users") {
			return null;
		}
		if (ownerSelection === "my_users") {
			return userData.username;
		}
		if (ownerSelection.startsWith("admin:")) {
			return ownerSelection.replace(/^admin:/, "");
		}
		return userData.username;
	};

	const showToast = (
		description: string,
		status: "success" | "error" | "warning",
	) => {
		toast({
			title: t("filters.advancedActions.modalTitle", "Advanced actions"),
			description,
			status,
			isClosable: true,
		});
	};

	const resolveErrorMessage = (error?: unknown, fallback?: string) => {
		if (error && typeof error === "object") {
			const maybe = error as { data?: { detail?: string }; message?: string };
			return maybe.data?.detail || maybe.message || fallback;
		}
		return fallback;
	};

	const handleError = (message?: string) => {
		showToast(
			message ??
				t("filters.advancedActions.error.general", "Unable to perform action"),
			"error",
		);
	};

	const buildServiceScopePayload = (): ServiceScopePayload => {
		if (selectedServiceValue === "no_service") {
			return { service_id_is_null: true };
		}
		if (!selectedServiceValue) {
			return {};
		}
		return { service_id: Number(selectedServiceValue) };
	};

	const handleExpireAction = async (action: AdvancedUserActionType) => {
		const days = Number(expireDays);
		if (!Number.isFinite(days) || days <= 0) {
			showToast(
				t(
					"filters.advancedActions.error.invalidDays",
					"Enter a positive number of days",
				),
				"warning",
			);
			return;
		}
		if (!selectedScopeStatuses.length) {
			showToast(
				t(
					"filters.advancedActions.error.noScope",
					"Select at least one status scope",
				),
				"warning",
			);
			return;
		}
		const setLoading =
			action === "extend_expire" ? setIsExtending : setIsReducing;
		setLoading(true);
		try {
			const targetAdminUsername = resolveTargetAdminUsername();
			const payload: AdvancedUserActionPayload = {
				action,
				days: Math.floor(days),
				scope: selectedScopeStatuses,
				admin_username: targetAdminUsername,
				...buildServiceScopePayload(),
			};
			const result = await performBulkUserAction(payload);
			showToast(
				t("filters.advancedActions.success.expire", {
					count: result.count ?? 0,
				}),
				"success",
			);
			setExpireDays("");
		} catch (error) {
			handleError(resolveErrorMessage(error));
		} finally {
			setLoading(false);
		}
	};

	const handleTrafficAction = async (action: AdvancedUserActionType) => {
		const value = Number(trafficGb);
		if (!Number.isFinite(value) || value <= 0) {
			showToast(
				t(
					"filters.advancedActions.error.invalidGigabytes",
					"Enter a positive traffic value",
				),
				"warning",
			);
			return;
		}
		if (!selectedScopeStatuses.length) {
			showToast(
				t(
					"filters.advancedActions.error.noScope",
					"Select at least one status scope",
				),
				"warning",
			);
			return;
		}
		const setLoading =
			action === "increase_traffic"
				? setIsIncreasingTraffic
				: setIsDecreasingTraffic;
		setLoading(true);
		try {
			const targetAdminUsername = resolveTargetAdminUsername();
			const payload: AdvancedUserActionPayload = {
				action,
				gigabytes: value,
				scope: selectedScopeStatuses,
				admin_username: targetAdminUsername,
				...buildServiceScopePayload(),
			};
			const result = await performBulkUserAction(payload);
			showToast(
				t("filters.advancedActions.success.traffic", {
					count: result.count ?? 0,
					value,
				}),
				"success",
			);
			setTrafficGb("");
		} catch (error) {
			handleError(resolveErrorMessage(error));
		} finally {
			setLoading(false);
		}
	};

	const handleCleanup = async () => {
		const days = Number(cleanupDays);
		if (!Number.isFinite(days) || days <= 0) {
			showToast(
				t(
					"filters.advancedActions.error.invalidDays",
					"Enter a positive number of days",
				),
				"warning",
			);
			return;
		}
		if (!selectedStatuses.length) {
			showToast(
				t(
					"filters.advancedActions.error.noStatuses",
					"Select at least one status",
				),
				"warning",
			);
			return;
		}
		setIsCleaning(true);
		try {
			const targetAdminUsername = resolveTargetAdminUsername();
			const payload: AdvancedUserActionPayload = {
				action: "cleanup_status",
				days: Math.floor(days),
				statuses: selectedStatuses,
				admin_username: targetAdminUsername,
				...buildServiceScopePayload(),
			};
			const result = await performBulkUserAction(payload);
			showToast(
				t("filters.advancedActions.success.cleanup", {
					count: result.count ?? 0,
				}),
				"success",
			);
			setCleanupDays("");
		} catch (error) {
			handleError(resolveErrorMessage(error));
		} finally {
			setIsCleaning(false);
		}
	};

	const handleChangeService = async () => {
		if (!targetServiceValue) {
			showToast(
				t(
					"filters.advancedActions.error.targetServiceRequired",
					"Select a target service first",
				),
				"warning",
			);
			return;
		}
		const resolvedTargetServiceId =
			targetServiceValue === "no_service" ? null : Number(targetServiceValue);
		setIsChangingService(true);
		try {
			const payload: AdvancedUserActionPayload = {
				action: "change_service",
				admin_username: resolveTargetAdminUsername(),
				...buildServiceScopePayload(),
				target_service_id: resolvedTargetServiceId,
			};
			const result = await performBulkUserAction(payload);
			showToast(
				t("filters.advancedActions.success.changeService", {
					count: result.count ?? 0,
				}),
				"success",
			);
		} catch (error) {
			handleError(resolveErrorMessage(error));
		} finally {
			setIsChangingService(false);
		}
	};

	const toggleStatus = (status: AdvancedUserActionStatus) => {
		setSelectedStatuses((prev) =>
			prev.includes(status)
				? prev.filter((item) => item !== status)
				: [...prev, status],
		);
	};

	const toggleScopeStatus = (status: AdvancedUserActionScopeStatus) => {
		setSelectedScopeStatuses((prev) =>
			prev.includes(status)
				? prev.filter((item) => item !== status)
				: [...prev, status],
		);
	};

	const isMobile = useBreakpointValue({ base: true, sm: false }) ?? false;

	if (!canUseAdvanced) {
		return null;
	}

	return (
		<>
			<Button
				leftIcon={<SparklesIcon className="w-4 h-4" />}
				onClick={onOpen}
				size={isMobile ? "sm" : "md"}
				variant="outline"
				h={isMobile ? "36px" : undefined}
				minW={isMobile ? "auto" : "8.5rem"}
				fontSize={isMobile ? "xs" : "sm"}
				fontWeight="semibold"
				whiteSpace="nowrap"
			>
				{t("filters.advancedActions.button", "Advanced actions")}
			</Button>

			<Modal isOpen={isOpen} onClose={onClose} size="lg">
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>
						{t("filters.advancedActions.modalTitle", "Advanced actions")}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						<VStack spacing={6} align="stretch">
							<Alert status="warning" borderRadius="md">
								<AlertIcon />
								<Text>
									{t(
										"filters.advancedActions.modalDescription",
										"These tools update every user and cannot be undone. Please double-check the values before confirming.",
									)}
								</Text>
							</Alert>

							{hasScopeSelect && (
								<FormControl>
									<FormLabel fontWeight="semibold">
										{t("filters.advancedActions.scope.label", "Scope")}
									</FormLabel>
									<Select
										value={ownerSelection}
										onChange={(event) => {
											const nextValue = event.target.value;
											if (
												nextValue === "my_users" ||
												nextValue === "all_users" ||
												nextValue.startsWith("admin:")
											) {
												setOwnerSelection(nextValue as OwnerSelection);
											}
										}}
										size="sm"
									>
										<option value="my_users">
											{t("filters.advancedActions.scope.myUsers", "My users")}
										</option>
										<option value="all_users">
											{t("filters.advancedActions.scope.allUsers", "All users")}
										</option>
										{adminList
											.filter((record) => record.username !== userData.username)
											.map((record) => (
												<option
													key={record.username}
													value={`admin:${record.username}`}
												>
													{record.username}
												</option>
											))}
									</Select>
									<FormHelperText fontSize="sm">
										{t(
											"filters.advancedActions.scope.helper",
											"Select an admin or all users for this action.",
										)}
									</FormHelperText>
								</FormControl>
							)}

							{canSeeServiceControls && (
								<>
									<FormControl>
										<FormLabel fontWeight="semibold">
											{t(
												"filters.advancedActions.service.label",
												"Service scope",
											)}
										</FormLabel>
										<Select
											value={selectedServiceValue}
											onChange={(event) => {
												setSelectedServiceValue(event.target.value);
											}}
											size="sm"
										>
											<option value="">
												{t(
													"filters.advancedActions.service.all",
													"All services",
												)}
											</option>
											<option value="no_service">
												{t(
													"filters.advancedActions.serviceChange.noService",
													"No service",
												)}
											</option>
											{servicesStore.services.map((service) => (
												<option key={service.id} value={String(service.id)}>
													{service.name}
												</option>
											))}
										</Select>
										<FormHelperText fontSize="sm">
											{t(
												"filters.advancedActions.service.helper",
												"Apply these actions only to users of the selected service.",
											)}
										</FormHelperText>
									</FormControl>

									<Box borderWidth="1px" borderRadius="md" px={4} py={4}>
										<Stack spacing={3}>
											<Text fontWeight="semibold">
												{t(
													"filters.advancedActions.serviceChange.title",
													"Change users' service",
												)}
											</Text>
											<Text fontSize="sm" color="gray.500">
												{t(
													"filters.advancedActions.serviceChange.helper",
													"Move the filtered users to another service.",
												)}
											</Text>
											<Select
												placeholder={t(
													"filters.advancedActions.serviceChange.placeholder",
													"Select target service",
												)}
												value={targetServiceValue}
												onChange={(event) =>
													setTargetServiceValue(event.target.value)
												}
												size="sm"
											>
												<option value="no_service">
													{t(
														"filters.advancedActions.serviceChange.noService",
														"No service",
													)}
												</option>
												{servicesStore.services.map((service) => (
													<option key={service.id} value={String(service.id)}>
														{service.name}
													</option>
												))}
											</Select>
											<Button
												colorScheme="primary"
												size="sm"
												alignSelf="flex-start"
												isLoading={isChangingService}
												onClick={handleChangeService}
											>
												{t(
													"filters.advancedActions.serviceChange.button",
													"Move to service",
												)}
											</Button>
										</Stack>
									</Box>
								</>
							)}

							<Box borderWidth="1px" borderRadius="md" px={4} py={4}>
								<Stack spacing={2}>
									<Text fontWeight="semibold">
										{t(
											"filters.advancedActions.scopeStatuses.title",
											"Status scope",
										)}
									</Text>
									<Text fontSize="sm" color="gray.500">
										{t(
											"filters.advancedActions.scopeStatuses.helper",
											"Choose which user statuses are affected by expiration and traffic changes.",
										)}
									</Text>
									<HStack spacing={3} flexWrap="wrap">
										{scopeStatusOptions.map((status) => (
											<Checkbox
												key={status}
												isChecked={selectedScopeStatuses.includes(status)}
												onChange={() => toggleScopeStatus(status)}
											>
												{t(
													`filters.advancedActions.scopeStatuses.${status}`,
													status.replace("_", " "),
												)}
											</Checkbox>
										))}
									</HStack>
								</Stack>
							</Box>

							<Stack spacing={4}>
								<Box borderWidth="1px" borderRadius="md" px={4} py={4}>
									<Stack spacing={2}>
										<Text fontWeight="semibold">
											{t(
												"filters.advancedActions.expireSection.title",
												"Expiration dates",
											)}
										</Text>
										<Text fontSize="sm" color="gray.500">
											{t(
												"filters.advancedActions.expireSection.description",
												"Add or subtract days from every user's expiration timestamp.",
											)}
										</Text>
										<FormControl>
											<FormLabel>
												{t(
													"filters.advancedActions.expireSection.inputLabel",
													"Days",
												)}
											</FormLabel>
											<NumberInput
												value={expireDays}
												onChange={(value) => setExpireDays(value)}
												min={1}
												step={1}
												w="full"
											>
												<NumberInputField />
											</NumberInput>
											<FormHelperText>
												{t(
													"filters.advancedActions.expireSection.helper",
													"The entered value will be added or removed when you click a button.",
												)}
											</FormHelperText>
										</FormControl>
										<HStack spacing={2} flexWrap="wrap">
											<Button
												colorScheme="primary"
												isLoading={isExtending}
												flex="1"
												minW="150px"
												onClick={() => handleExpireAction("extend_expire")}
											>
												{t(
													"filters.advancedActions.expireSection.addButton",
													"Add days to all users",
												)}
											</Button>
											<Button
												colorScheme="gray"
												variant="outline"
												isLoading={isReducing}
												flex="1"
												minW="150px"
												onClick={() => handleExpireAction("reduce_expire")}
											>
												{t(
													"filters.advancedActions.expireSection.removeButton",
													"Subtract days from all users",
												)}
											</Button>
										</HStack>
									</Stack>
								</Box>

								<Box borderWidth="1px" borderRadius="md" px={4} py={4}>
									<Stack spacing={2}>
										<Text fontWeight="semibold">
											{t(
												"filters.advancedActions.trafficSection.title",
												"Usage and traffic",
											)}
										</Text>
										<Text fontSize="sm" color="gray.500">
											{t(
												"filters.advancedActions.trafficSection.description",
												"Apply a data limit adjustment to all users.",
											)}
										</Text>
										<FormControl>
											<FormLabel>
												{t(
													"filters.advancedActions.trafficSection.inputLabel",
													"Gigabytes",
												)}
											</FormLabel>
											<NumberInput
												value={trafficGb}
												onChange={(value) => setTrafficGb(value)}
												min={0.01}
												step={0.1}
												w="full"
											>
												<NumberInputField />
											</NumberInput>
										</FormControl>
										<HStack spacing={2} flexWrap="wrap">
											<Button
												colorScheme="primary"
												isLoading={isIncreasingTraffic}
												flex="1"
												minW="150px"
												onClick={() => handleTrafficAction("increase_traffic")}
											>
												{t(
													"filters.advancedActions.trafficSection.addButton",
													"Add traffic to all users",
												)}
											</Button>
											<Button
												colorScheme="gray"
												variant="outline"
												isLoading={isDecreasingTraffic}
												flex="1"
												minW="150px"
												onClick={() => handleTrafficAction("decrease_traffic")}
											>
												{t(
													"filters.advancedActions.trafficSection.removeButton",
													"Subtract traffic from all users",
												)}
											</Button>
										</HStack>
									</Stack>
								</Box>

								<Box borderWidth="1px" borderRadius="md" px={4} py={4}>
									<Stack spacing={2}>
										<Text fontWeight="semibold">
											{t(
												"filters.advancedActions.cleanupSection.title",
												"Cleanup expired or limited",
											)}
										</Text>
										<Text fontSize="sm" color="gray.500">
											{t(
												"filters.advancedActions.cleanupSection.description",
												"Remove users that have been expired/limited for the selected number of days.",
											)}
										</Text>
										<FormControl>
											<FormLabel>
												{t(
													"filters.advancedActions.cleanupSection.daysLabel",
													"Days since status change",
												)}
											</FormLabel>
											<NumberInput
												value={cleanupDays}
												onChange={(value) => setCleanupDays(value)}
												min={1}
												step={1}
												w="full"
											>
												<NumberInputField />
											</NumberInput>
										</FormControl>
										<HStack spacing={3}>
											{cleanupOptions.map((status) => (
												<Checkbox
													key={status}
													isChecked={selectedStatuses.includes(status)}
													onChange={() => toggleStatus(status)}
												>
													{t(
														`filters.advancedActions.cleanupSection.statuses.${status}`,
														status.charAt(0).toUpperCase() + status.slice(1),
													)}
												</Checkbox>
											))}
										</HStack>
										<Button
											colorScheme="primary"
											isLoading={isCleaning}
											w="full"
											onClick={handleCleanup}
										>
											{t(
												"filters.advancedActions.cleanupSection.button",
												"Delete selected users",
											)}
										</Button>
									</Stack>
								</Box>
							</Stack>
						</VStack>
					</ModalBody>
					<ModalFooter>
						<Button variant="ghost" onClick={onClose}>
							{t("filters.advancedActions.close", "Close")}
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	);
};

export default AdvancedUserActions;
