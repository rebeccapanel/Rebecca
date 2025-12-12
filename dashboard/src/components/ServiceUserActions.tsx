import {
	Box,
	Button,
	Heading,
	HStack,
	NumberInput,
	NumberInputField,
	Stack,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { BoltIcon, ClockIcon } from "@heroicons/react/24/outline";
import { useServicesStore } from "contexts/ServicesContext";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	AdvancedUserActionPayload,
	AdvancedUserActionType,
} from "types/User";

type Props = {
	serviceId: number;
};

const ServiceUserActions = ({ serviceId }: Props) => {
	const { t } = useTranslation();
	const toast = useToast();
	const performServiceUserAction = useServicesStore(
		(state) => state.performServiceUserAction,
	);

	const [days, setDays] = useState("");
	const [gigabytes, setGigabytes] = useState("");
	const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});

	const setActionLoading = (key: string, value: boolean) =>
		setIsLoading((prev) => ({ ...prev, [key]: value }));

	const showResult = (detail: string, count?: number) => {
		toast({
			title: t("services.userActions.title", "Service user actions"),
			description: count !== undefined ? `${detail} (${count})` : detail,
			status: "success",
			isClosable: true,
		});
	};

	const showError = (error: any) => {
		const detail =
			error?.data?.detail ||
			error?.message ||
			t("services.userActions.error", "Unable to perform action");
		toast({
			title: t("services.userActions.title", "Service user actions"),
			description: detail,
			status: "error",
			isClosable: true,
		});
	};

	const runAction = async (
		action: AdvancedUserActionType,
		extra?: Partial<AdvancedUserActionPayload>,
	) => {
		const key = action;
		setActionLoading(key, true);
		try {
			const payload: AdvancedUserActionPayload = {
				action,
				service_id: serviceId,
				...extra,
			};
			const result = await performServiceUserAction(serviceId, payload);
			showResult(result.detail, result.count);
		} catch (error) {
			showError(error);
		} finally {
			setActionLoading(key, false);
		}
	};

	const handleDays = (action: AdvancedUserActionType) => {
		const value = Number(days);
		if (!Number.isFinite(value) || value <= 0) {
			toast({
				title: t("services.userActions.title", "Service user actions"),
				description: t(
					"filters.advancedActions.error.invalidDays",
					"Enter a positive number of days",
				),
				status: "warning",
				isClosable: true,
			});
			return;
		}
		runAction(action, { days: Math.floor(value) });
		setDays("");
	};

	const handleTraffic = (action: AdvancedUserActionType) => {
		const value = Number(gigabytes);
		if (!Number.isFinite(value) || value <= 0) {
			toast({
				title: t("services.userActions.title", "Service user actions"),
				description: t(
					"filters.advancedActions.error.invalidGigabytes",
					"Enter a positive traffic value",
				),
				status: "warning",
				isClosable: true,
			});
			return;
		}
		runAction(action, { gigabytes: value });
		setGigabytes("");
	};

	return (
		<Box borderWidth="1px" borderRadius="lg" p={4}>
			<Stack spacing={3}>
				<HStack spacing={2}>
					<BoltIcon width={18} height={18} />
					<Heading size="sm">
						{t("services.userActions.title", "Service user actions")}
					</Heading>
				</HStack>
				<Text fontSize="sm" color="gray.500">
					{t(
						"services.userActions.description",
						"Quickly adjust or toggle all users under this service without leaving the page.",
					)}
				</Text>

				<VStack align="stretch" spacing={4}>
					<Box borderWidth="1px" borderRadius="md" p={3}>
						<Stack spacing={2}>
							<HStack spacing={2}>
								<ClockIcon width={16} height={16} />
								<Text fontWeight="semibold">
									{t("services.userActions.expire.title", "Expiration")}
								</Text>
							</HStack>
							<Text fontSize="sm" color="gray.500">
								{t(
									"services.userActions.expire.helper",
									"Add or remove days for users in this service.",
								)}
							</Text>
							<NumberInput
								value={days}
								onChange={(value) => setDays(value)}
								min={1}
								step={1}
								size="sm"
							>
								<NumberInputField
									placeholder={t("services.userActions.expire.days", "Days")}
								/>
							</NumberInput>
							<HStack spacing={2} flexWrap="wrap">
								<Button
									size="sm"
									colorScheme="primary"
									isLoading={isLoading.extend_expire}
									onClick={() => handleDays("extend_expire")}
								>
									{t("services.userActions.expire.add", "Add days")}
								</Button>
								<Button
									size="sm"
									variant="outline"
									isLoading={isLoading.reduce_expire}
									onClick={() => handleDays("reduce_expire")}
								>
									{t("services.userActions.expire.subtract", "Subtract days")}
								</Button>
							</HStack>
						</Stack>
					</Box>

					<Box borderWidth="1px" borderRadius="md" p={3}>
						<Stack spacing={2}>
							<Text fontWeight="semibold">
								{t("services.userActions.traffic.title", "Traffic")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"services.userActions.traffic.helper",
									"Adjust traffic for all users in this service.",
								)}
							</Text>
							<NumberInput
								value={gigabytes}
								onChange={(value) => setGigabytes(value)}
								min={0.01}
								step={0.1}
								size="sm"
							>
								<NumberInputField
									placeholder={t(
										"services.userActions.traffic.gigabytes",
										"Gigabytes",
									)}
								/>
							</NumberInput>
							<HStack spacing={2} flexWrap="wrap">
								<Button
									size="sm"
									colorScheme="primary"
									isLoading={isLoading.increase_traffic}
									onClick={() => handleTraffic("increase_traffic")}
								>
									{t("services.userActions.traffic.add", "Add traffic")}
								</Button>
								<Button
									size="sm"
									variant="outline"
									isLoading={isLoading.decrease_traffic}
									onClick={() => handleTraffic("decrease_traffic")}
								>
									{t(
										"services.userActions.traffic.subtract",
										"Subtract traffic",
									)}
								</Button>
							</HStack>
						</Stack>
					</Box>

					<Box borderWidth="1px" borderRadius="md" p={3}>
						<Stack spacing={2}>
							<Text fontWeight="semibold">
								{t("services.userActions.status.title", "Status")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"services.userActions.status.helper",
									"Enable or disable all users in this service.",
								)}
							</Text>
							<HStack spacing={2} flexWrap="wrap">
								<Button
									size="sm"
									colorScheme="green"
									isLoading={isLoading.activate_users}
									onClick={() => runAction("activate_users")}
								>
									{t("services.userActions.status.activate", "Activate users")}
								</Button>
								<Button
									size="sm"
									colorScheme="red"
									variant="outline"
									isLoading={isLoading.disable_users}
									onClick={() => runAction("disable_users")}
								>
									{t("services.userActions.status.disable", "Disable users")}
								</Button>
							</HStack>
						</Stack>
					</Box>
				</VStack>
			</Stack>
		</Box>
	);
};

export default ServiceUserActions;
