import {
	Alert,
	AlertIcon,
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	FormControl,
	FormHelperText,
	FormLabel,
	Heading,
	HStack,
	Input,
	SimpleGrid,
	Stack,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	useColorModeValue,
	useToast,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { PanelSelect } from "components/common/PanelSelect";
import { PageLoadingSkeleton } from "components/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "react-query";
import {
	getSubscriptionPlaceholderSettings,
	type SubscriptionPlaceholderSetting,
	updateSubscriptionPlaceholderSetting,
} from "service/settings";

const keyFor = (
	item: Pick<SubscriptionPlaceholderSetting, "admin_id" | "service_id">,
) => `${item.admin_id ?? "default"}:${item.service_id}`;

const PlaceholderSettingsPage = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const panelBg = useColorModeValue("whiteAlpha.800", "whiteAlpha.50");
	const subtleBg = useColorModeValue("blackAlpha.50", "whiteAlpha.50");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const query = useQuery(
		"subscription-placeholder-settings",
		getSubscriptionPlaceholderSettings,
		{ refetchOnWindowFocus: false },
	);
	const [selectedKey, setSelectedKey] = useState("");
	const [draft, setDraft] = useState<SubscriptionPlaceholderSetting | null>(
		null,
	);

	const items = query.data?.items ?? [];
	const selected =
		items.find((item) => keyFor(item) === selectedKey) ?? items[0] ?? null;

	useEffect(() => {
		if (selected && selectedKey !== keyFor(selected)) {
			setSelectedKey(keyFor(selected));
		}
	}, [selected, selectedKey]);

	useEffect(() => {
		setDraft(selected ? { ...selected } : null);
	}, [selected]);

	const admins = useMemo(
		() =>
			Array.from(
				new Map(
					items
						.filter((item) => item.admin_id !== null)
						.map((item) => [item.admin_id as number, item.admin_username]),
				).entries(),
			),
		[items],
	);
	const adminItems = selected
		? items.filter((item) => item.admin_id === selected.admin_id)
		: [];

	const save = useMutation(updateSubscriptionPlaceholderSetting, {
		onSuccess: async (updated) => {
			setDraft(updated);
			setSelectedKey(keyFor(updated));
			await query.refetch();
			toast({
				title: t("placeholders.saved"),
				status: "success",
				duration: 2500,
			});
		},
		onError: (error: Error) => {
			toast({
				title: t("placeholders.saveFailed"),
				description: error.message,
				status: "error",
				duration: 5000,
			});
		},
	});

	const selectAdmin = (value: string | string[]) => {
		const raw = Array.isArray(value) ? value[0] : value;
		const adminID = raw === "default" ? null : Number(raw);
		const first = items.find((item) => item.admin_id === adminID);
		if (first) setSelectedKey(keyFor(first));
	};
	const selectService = (value: string | string[]) => {
		if (!selected) return;
		const serviceID = Number(Array.isArray(value) ? value[0] : value);
		setSelectedKey(`${selected.admin_id ?? "default"}:${serviceID}`);
	};
	const updateDraft = <K extends keyof SubscriptionPlaceholderSetting>(
		key: K,
		value: SubscriptionPlaceholderSetting[K],
	) =>
		setDraft((current) => (current ? { ...current, [key]: value } : current));

	if (query.isLoading) {
		return <PageLoadingSkeleton />;
	}
	if (query.isError) {
		return (
			<Alert status="error" borderRadius="xl">
				<AlertIcon />
				{t("placeholders.loadFailed")}
			</Alert>
		);
	}

	return (
		<Stack spacing={5} maxW="1180px" mx="auto">
			<Box>
				<Heading size="lg">{t("placeholders.title")}</Heading>
				<Text mt={2} color="panel.textSecondary" maxW="760px">
					{t("placeholders.subtitle")}
				</Text>
			</Box>

			<Tabs variant="soft-rounded" colorScheme="pink">
				<TabList>
					<Tab>{t("placeholders.tab")}</Tab>
				</TabList>
				<TabPanels>
					<TabPanel px={0} pb={0}>
						<Card
							bg={panelBg}
							border="1px solid"
							borderColor={borderColor}
							borderRadius="2xl"
							boxShadow="0 18px 50px rgba(0,0,0,.12)"
						>
							<CardBody p={{ base: 4, md: 7 }}>
								{!draft ? (
									<Box textAlign="center" py={14}>
										<DocumentDuplicateIcon
											width="42"
											style={{ margin: "0 auto" }}
										/>
										<Heading size="sm" mt={4}>
											{t("placeholders.noServices")}
										</Heading>
										<Text color="panel.textSecondary" mt={2}>
											{t("placeholders.noServicesHint")}
										</Text>
									</Box>
								) : (
									<Stack spacing={7}>
										<SimpleGrid
											columns={{ base: 1, md: query.data?.manage_all ? 2 : 1 }}
											spacing={4}
										>
											{query.data?.manage_all && (
												<FormControl>
													<FormLabel>{t("placeholders.scope")}</FormLabel>
													<PanelSelect
														value={draft.admin_id === null ? "default" : String(draft.admin_id)}
														onValueChange={selectAdmin}
														options={[
															{ value: "default", label: t("placeholders.serviceDefaults") },
															...admins.map(([id, username]) => ({ value: String(id), label: username })),
														]}
													/>
												</FormControl>
											)}
											<FormControl>
												<FormLabel>{t("placeholders.service")}</FormLabel>
												<PanelSelect
													value={String(draft.service_id)}
													onValueChange={selectService}
													options={adminItems.map((item) => ({
														value: String(item.service_id),
														label: item.service_name,
													}))}
												/>
											</FormControl>
										</SimpleGrid>

										{!draft.is_default && (
											<HStack
												bg={subtleBg}
												border="1px solid"
												borderColor={borderColor}
												borderRadius="xl"
												p={4}
												justify="space-between"
											>
												<Box>
													<Text fontWeight="semibold">{t("placeholders.inherit")}</Text>
													<Text fontSize="sm" color="panel.textSecondary" mt={1}>{t("placeholders.inheritHint")}</Text>
												</Box>
												<Switch
													colorScheme="pink"
													isChecked={draft.inherited}
													onChange={(event) => updateDraft("inherited", event.target.checked)}
												/>
											</HStack>
										)}

										<HStack
											bg={subtleBg}
											border="1px solid"
											borderColor={borderColor}
											borderRadius="xl"
											p={4}
											justify="space-between"
											align="center"
										>
											<Box>
												<Text fontWeight="semibold">
													{t("placeholders.enabled")}
												</Text>
												<Text fontSize="sm" color="panel.textSecondary" mt={1}>
													{t("placeholders.enabledHint")}
												</Text>
											</Box>
											<Switch
												colorScheme="pink"
												isChecked={draft.enabled}
												isDisabled={draft.inherited}
												onChange={(event) =>
													updateDraft("enabled", event.target.checked)
												}
											/>
										</HStack>

										<Stack spacing={5}>
											<PlaceholderField
												label={t("placeholders.expired")}
												hint={t("placeholders.expiredHint")}
												color="orange.400"
												value={draft.expired_remark}
												isDisabled={draft.inherited}
												onChange={(value) =>
													updateDraft("expired_remark", value)
												}
											/>
											<PlaceholderField
												label={t("placeholders.limited")}
												hint={t("placeholders.limitedHint")}
												color="red.400"
												value={draft.limited_remark}
												isDisabled={draft.inherited}
												onChange={(value) =>
													updateDraft("limited_remark", value)
												}
											/>
											<PlaceholderField
												label={t("placeholders.disabled")}
												hint={t("placeholders.disabledHint")}
												color="gray.400"
												value={draft.disabled_remark}
												isDisabled={draft.inherited}
												onChange={(value) =>
													updateDraft("disabled_remark", value)
												}
											/>
										</Stack>

										<Box>
											<Text fontSize="sm" fontWeight="semibold" mb={2}>
												{t("placeholders.variables")}
											</Text>
											<Wrap>
												{[
													"{USERNAME}",
													"{STATUS_TEXT}",
													"{DATA_USAGE}",
													"{DATA_LIMIT}",
													"{EXPIRE_DATE}",
												].map((variable) => (
													<WrapItem key={variable}>
														<Badge
															px={2.5}
															py={1}
															borderRadius="full"
															textTransform="none"
														>
															{variable}
														</Badge>
													</WrapItem>
												))}
											</Wrap>
											<Text color="panel.textSecondary" fontSize="sm" mt={2}>
												{t("placeholders.variablesHint")}
											</Text>
										</Box>

										<HStack justify="flex-end">
											<Button
												colorScheme="pink"
												isLoading={save.isLoading}
												onClick={() => save.mutate({ ...draft, inherit_default: draft.inherited })}
											>
												{t("placeholders.save")}
											</Button>
										</HStack>
									</Stack>
								)}
							</CardBody>
						</Card>
					</TabPanel>
				</TabPanels>
			</Tabs>
		</Stack>
	);
};

const PlaceholderField = ({
	label,
	hint,
	color,
	value,
	isDisabled,
	onChange,
}: {
	label: string;
	hint: string;
	color: string;
	value: string;
	isDisabled?: boolean;
	onChange: (value: string) => void;
}) => (
	<FormControl>
		<HStack mb={2} spacing={2}>
			<Box boxSize="8px" borderRadius="full" bg={color} />
			<FormLabel mb={0}>{label}</FormLabel>
		</HStack>
		<Input
			value={value}
			isDisabled={isDisabled}
			maxLength={255}
			onChange={(event) => onChange(event.target.value)}
		/>
		<FormHelperText>{hint}</FormHelperText>
	</FormControl>
);

export default PlaceholderSettingsPage;
