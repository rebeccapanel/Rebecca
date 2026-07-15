import {
	Badge,
	Box,
	Button,
	Divider,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	IconButton,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	SimpleGrid,
	Spinner,
	Switch,
	Table,
	Tag,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	useToast,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import {
	ArrowDownIcon,
	ArrowPathIcon,
	ArrowUpIcon,
	EyeIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { AppleEmojiText } from "./common/AppleEmojiText";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type OutboundSub = {
	id: number;
	remark?: string;
	url?: string;
	enabled?: boolean;
	allowPrivate?: boolean;
	tagPrefix?: string;
	updateInterval?: number;
	priority?: number;
	prepend?: boolean;
	lastUpdated?: number;
	lastError?: string;
	outboundCount?: number;
};

type OutboundSubForm = {
	remark: string;
	url: string;
	tagPrefix: string;
	updateInterval: number;
	enabled: boolean;
	allowPrivate: boolean;
	prepend: boolean;
};

const blankForm: OutboundSubForm = {
	remark: "",
	url: "",
	tagPrefix: "",
	updateInterval: 600,
	enabled: true,
	allowPrivate: false,
	prepend: false,
};

type Props = {
	isOpen: boolean;
	onClose: () => void;
	onChanged?: () => void | Promise<void>;
};

const parseAPIError = (error: any, fallback: string) =>
	error?.response?._data?.detail ??
	error?.data?.detail ??
	error?.message ??
	fallback;

const responseOK = (response: any) => response?.success !== false;

export const OutboundSubscriptionsModal: FC<Props> = ({
	isOpen,
	onClose,
	onChanged,
}) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [items, setItems] = useState<OutboundSub[]>([]);
	const [form, setForm] = useState<OutboundSubForm>(blankForm);
	const [editingID, setEditingID] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [busyID, setBusyID] = useState<number | null>(null);
	const [preview, setPreview] = useState<Array<Record<string, any>>>([]);

	const intervalMinutes = useMemo(
		() => Math.max(1, Math.round((form.updateInterval || 600) / 60)),
		[form.updateInterval],
	);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiFetch<{ success: boolean; obj: OutboundSub[] }>(
				"/panel/xray/outbound-subs",
			);
			if (responseOK(response)) {
				setItems(Array.isArray(response.obj) ? response.obj : []);
			}
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.outboundSub.toastLoadFailed", "Unable to load outbound subscriptions"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setLoading(false);
		}
	}, [t, toast]);

	useEffect(() => {
		if (isOpen) {
			void load();
		}
	}, [isOpen, load]);

	const resetForm = () => {
		setForm(blankForm);
		setEditingID(null);
		setPreview([]);
	};

	const edit = (item: OutboundSub) => {
		setEditingID(item.id);
		setForm({
			remark: item.remark ?? "",
			url: item.url ?? "",
			tagPrefix: item.tagPrefix ?? "",
			updateInterval: item.updateInterval ?? 600,
			enabled: item.enabled ?? true,
			allowPrivate: item.allowPrivate ?? false,
			prepend: item.prepend ?? false,
		});
		setPreview([]);
	};

	const notifyChanged = async () => {
		await load();
		await onChanged?.();
	};

	const save = async () => {
		if (!form.url.trim()) {
			toast({
				title: t("pages.xray.outboundSub.toastUrlRequired", "Subscription URL is required"),
				status: "warning",
				isClosable: true,
				position: "top",
			});
			return;
		}
		setSaving(true);
		try {
			const path =
				editingID === null
					? "/panel/xray/outbound-subs"
					: `/panel/xray/outbound-subs/${editingID}`;
			const response = await apiFetch(path, { method: "POST", body: form });
			if (responseOK(response)) {
				toast({
					title:
						editingID === null
							? t("pages.xray.outboundSub.toastAdded", "Outbound subscription added")
							: t("pages.xray.outboundSub.toastUpdated", "Outbound subscription updated"),
					status: "success",
					isClosable: true,
					position: "top",
				});
				resetForm();
				await notifyChanged();
			}
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.outboundSub.toastAddFailed", "Unable to save outbound subscription"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setSaving(false);
		}
	};

	const previewURL = async () => {
		if (!form.url.trim()) return;
		setPreviewing(true);
		setPreview([]);
		try {
			const response = await apiFetch<{
				success: boolean;
				obj: Array<Record<string, any>>;
			}>("/panel/xray/outbound-subs/parse", {
				method: "POST",
				body: {
					url: form.url,
					allowPrivate: form.allowPrivate,
				},
			});
			if (responseOK(response)) {
				setPreview(Array.isArray(response.obj) ? response.obj : []);
			}
		} catch (error: any) {
			toast({
				title: parseAPIError(
					error,
					t("pages.xray.outboundSub.previewEmpty", "Unable to parse this subscription"),
				),
				status: "error",
				isClosable: true,
				position: "top",
			});
		} finally {
			setPreviewing(false);
		}
	};

	const refreshOne = async (id: number) => {
		setBusyID(id);
		try {
			await apiFetch(`/panel/xray/outbound-subs/${id}/refresh`, {
				method: "POST",
			});
			await notifyChanged();
		} finally {
			setBusyID(null);
		}
	};

	const deleteOne = async (id: number) => {
		setBusyID(id);
		try {
			await apiFetch(`/panel/xray/outbound-subs/${id}/del`, { method: "POST" });
			await notifyChanged();
		} finally {
			setBusyID(null);
		}
	};

	const toggle = async (item: OutboundSub) => {
		setBusyID(item.id);
		try {
			await apiFetch(`/panel/xray/outbound-subs/${item.id}`, {
				method: "POST",
				body: {
					remark: item.remark ?? "",
					url: item.url ?? "",
					tagPrefix: item.tagPrefix ?? "",
					updateInterval: item.updateInterval ?? 600,
					enabled: !item.enabled,
					allowPrivate: item.allowPrivate ?? false,
					prepend: item.prepend ?? false,
				},
			});
			await notifyChanged();
		} finally {
			setBusyID(null);
		}
	};

	const move = async (id: number, dir: "up" | "down") => {
		setBusyID(id);
		try {
			await apiFetch(`/panel/xray/outbound-subs/${id}/move`, {
				method: "POST",
				body: { dir },
			});
			await notifyChanged();
		} finally {
			setBusyID(null);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="4xl"
			scrollBehavior="inside"
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3">
				<XrayModalHeader>
					{t("pages.xray.outboundSub.title", "Outbound subscriptions")}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<VStack align="stretch" spacing={4}>
						<Box className="xray-section">
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								<FormControl>
									<FormLabel>{t("pages.xray.outboundSub.remark", "Remark")}</FormLabel>
									<Input
										size="sm"
										value={form.remark}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, remark: event.target.value }))
										}
										placeholder={t("pages.xray.outboundSub.remarkPlaceholder", "Provider name")}
									/>
								</FormControl>
								<FormControl isRequired>
									<FormLabel>{t("pages.xray.outboundSub.url", "Subscription URL")}</FormLabel>
									<Input
										size="sm"
										value={form.url}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, url: event.target.value }))
										}
										placeholder="https://example.com/sub"
									/>
								</FormControl>
								<FormControl>
									<FormLabel>{t("pages.xray.outboundSub.tagPrefix", "Tag prefix")}</FormLabel>
									<Input
										size="sm"
										value={form.tagPrefix}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, tagPrefix: event.target.value }))
										}
										placeholder="sub1-"
									/>
									<FormHelperText>
										{t("pages.xray.outboundSub.tagPrefixHint", "Used to make stable outbound tags after refresh.")}
									</FormHelperText>
								</FormControl>
								<FormControl>
									<FormLabel>{t("pages.xray.outboundSub.interval", "Refresh interval")}</FormLabel>
									<Input
										size="sm"
										type="number"
										min={1}
										value={intervalMinutes}
										onChange={(event) =>
											setForm((prev) => ({
												...prev,
												updateInterval: Math.max(60, Number(event.target.value || 10) * 60),
											}))
										}
									/>
									<FormHelperText>
										{t("pages.xray.outboundSub.intervalHint", "Minutes between automatic refreshes.")}
									</FormHelperText>
								</FormControl>
							</SimpleGrid>
							<HStack mt={3} spacing={5} wrap="wrap">
								<HStack>
									<Switch
										size="sm"
										isChecked={form.enabled}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, enabled: event.target.checked }))
										}
									/>
									<Text fontSize="sm">{t("pages.xray.outboundSub.enabled", "Enabled")}</Text>
								</HStack>
								<HStack>
									<Switch
										size="sm"
										isChecked={form.prepend}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, prepend: event.target.checked }))
										}
									/>
									<Text fontSize="sm">{t("pages.xray.outboundSub.prepend", "Prepend")}</Text>
								</HStack>
								<HStack>
									<Switch
										size="sm"
										isChecked={form.allowPrivate}
										onChange={(event) =>
											setForm((prev) => ({ ...prev, allowPrivate: event.target.checked }))
										}
									/>
									<Text fontSize="sm">{t("pages.xray.outboundSub.allowPrivate", "Allow private hosts")}</Text>
								</HStack>
							</HStack>
							{preview.length > 0 && (
								<Wrap mt={3} spacing={2}>
									{preview.map((item, index) => (
										<WrapItem key={`${item.tag}-${index}`}>
											<Tag size="sm" colorScheme="green">
												{item.tag || "-"} · {item.protocol || "-"}
											</Tag>
										</WrapItem>
									))}
								</Wrap>
							)}
						</Box>

						<Box className="xray-section">
							<HStack justify="space-between" mb={3}>
								<Box>
									<Text fontWeight="semibold">
										{t("pages.xray.outboundSub.active", "Saved subscriptions")}
									</Text>
									<Text color="gray.500" fontSize="xs">
										{t("pages.xray.outboundSub.restartHint", "Fetched outbounds are merged into node runtime config, not saved into the template.")}
									</Text>
								</Box>
								<Button
									size="xs"
									variant="ghost"
									leftIcon={<ArrowPathIcon width={14} />}
									isLoading={loading}
									onClick={load}
								>
									{t("refresh")}
								</Button>
							</HStack>
							<Divider mb={3} />
							{loading ? (
								<HStack justify="center" py={6}>
									<Spinner size="sm" />
								</HStack>
							) : items.length === 0 ? (
								<Text color="gray.500" fontSize="sm">
									{t("pages.xray.outboundSub.empty", "No outbound subscription yet.")}
								</Text>
							) : (
								<Table size="sm">
									<Thead>
										<Tr>
											<Th w="70px">#</Th>
											<Th>{t("pages.xray.outboundSub.colRemark", "Remark")}</Th>
											<Th>{t("pages.xray.Outbounds", "Outbounds")}</Th>
											<Th>{t("status")}</Th>
											<Th>{t("pages.xray.outboundSub.colEnabled", "Enabled")}</Th>
											<Th>{t("actions")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{items.map((item, index) => (
											<Tr key={item.id}>
												<Td>
													<HStack spacing={0}>
														<IconButton
															aria-label="up"
															size="xs"
															variant="ghost"
															icon={<ArrowUpIcon width={14} />}
															isDisabled={index === 0 || busyID === item.id}
															onClick={() => move(item.id, "up")}
														/>
														<IconButton
															aria-label="down"
															size="xs"
															variant="ghost"
															icon={<ArrowDownIcon width={14} />}
															isDisabled={index === items.length - 1 || busyID === item.id}
															onClick={() => move(item.id, "down")}
														/>
													</HStack>
												</Td>
												<Td maxW="260px">
													<Text fontWeight="semibold" noOfLines={1}>
														<AppleEmojiText>
															{item.remark || item.url || ""}
														</AppleEmojiText>
													</Text>
													<Text color="gray.500" fontSize="xs" noOfLines={1}>
														{item.tagPrefix || "sub-"} · {item.url}
													</Text>
												</Td>
												<Td>
													<Badge colorScheme="blue">{item.outboundCount ?? 0}</Badge>
												</Td>
												<Td>
													{item.lastError ? (
														<Tooltip label={item.lastError}>
															<Badge colorScheme="red">error</Badge>
														</Tooltip>
													) : (
														<Badge colorScheme="green">
															{item.lastUpdated
																? new Date(item.lastUpdated * 1000).toLocaleString()
																: t("pages.xray.outboundSub.never", "Never")}
														</Badge>
													)}
												</Td>
												<Td>
													<Switch
														size="sm"
														isChecked={!!item.enabled}
														isDisabled={busyID === item.id}
														onChange={() => toggle(item)}
													/>
												</Td>
												<Td>
													<HStack spacing={1}>
														<Button size="xs" variant="ghost" onClick={() => edit(item)}>
															{t("edit")}
														</Button>
														<IconButton
															aria-label="refresh"
															size="xs"
															variant="ghost"
															icon={<ArrowPathIcon width={14} />}
															isLoading={busyID === item.id}
															onClick={() => refreshOne(item.id)}
														/>
														<IconButton
															aria-label="delete"
															size="xs"
															variant="ghost"
															colorScheme="red"
															icon={<TrashIcon width={14} />}
															isDisabled={busyID === item.id}
															onClick={() => deleteOne(item.id)}
														/>
													</HStack>
												</Td>
											</Tr>
										))}
									</Tbody>
								</Table>
							)}
						</Box>
					</VStack>
				</XrayModalBody>
				<XrayModalFooter>
					<HStack w="full" justify="space-between" spacing={2} wrap="wrap">
						<Box>
							{editingID !== null && (
								<Button size="sm" variant="ghost" onClick={resetForm}>
									{t("cancel")}
								</Button>
							)}
						</Box>
						<HStack spacing={2} wrap="wrap">
							<Button
								size="sm"
								variant="ghost"
								leftIcon={<EyeIcon width={16} />}
								isLoading={previewing}
								onClick={previewURL}
							>
								{t("pages.xray.outboundSub.preview", "Preview")}
							</Button>
							<Button
								size="sm"
								colorScheme="primary"
								leftIcon={<PlusIcon width={16} />}
								isLoading={saving}
								onClick={save}
							>
								{editingID === null ? t("add") : t("save")}
							</Button>
							<Button size="sm" variant="ghost" onClick={onClose}>
								{t("close")}
							</Button>
						</HStack>
					</HStack>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
