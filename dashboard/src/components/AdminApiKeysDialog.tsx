import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Input,
	Select,
	Spinner,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import { ClipboardIcon, KeyIcon, TrashIcon } from "@heroicons/react/24/outline";
import { AppDialog } from "components/dialogs/AppDialog";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	createAdminApiKey,
	deleteAdminApiKey,
	listAdminApiKeys,
} from "service/auth";
import type { Admin } from "types/Admin";
import type { AdminApiKey } from "types/ApiKey";
import { copyTextToClipboard } from "utils/clipboard";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";

type Props = {
	admin: Admin | null;
	isOpen: boolean;
	onClose: () => void;
};

export const AdminApiKeysDialog = ({ admin, isOpen, onClose }: Props) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [keys, setKeys] = useState<AdminApiKey[]>([]);
	const [lifetime, setLifetime] = useState("1m");
	const [generatedKey, setGeneratedKey] = useState("");
	const [generatedKeyID, setGeneratedKeyID] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [deletingID, setDeletingID] = useState<number | null>(null);
	const [keyToDelete, setKeyToDelete] = useState<AdminApiKey | null>(null);

	useEffect(() => {
		if (!isOpen || !admin) return;
		let active = true;
		setLoading(true);
		setKeys([]);
		setGeneratedKey("");
		setGeneratedKeyID(null);
		listAdminApiKeys(admin.username)
			.then((items) => {
				if (active) setKeys(Array.isArray(items) ? items : []);
			})
			.catch((error) => {
				if (active) generateErrorMessage(error, toast);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [admin, isOpen, toast]);

	const close = () => {
		setKeys([]);
		setGeneratedKey("");
		setGeneratedKeyID(null);
		setKeyToDelete(null);
		onClose();
	};

	const create = async () => {
		if (!admin) return;
		setCreating(true);
		try {
			const created = await createAdminApiKey(admin.username, lifetime);
			const { api_key: secret, ...masked } = created;
			setKeys((current) => [masked, ...current]);
			setGeneratedKey(secret ?? "");
			setGeneratedKeyID(created.id);
			generateSuccessMessage(t("myaccount.apiKeyCreated"), toast);
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setCreating(false);
		}
	};

	const remove = async () => {
		if (!admin || !keyToDelete) return;
		setDeletingID(keyToDelete.id);
		try {
			await deleteAdminApiKey(admin.username, keyToDelete.id);
			setKeys((current) => current.filter((key) => key.id !== keyToDelete.id));
			if (keyToDelete.id === generatedKeyID) {
				setGeneratedKey("");
				setGeneratedKeyID(null);
			}
			setKeyToDelete(null);
			generateSuccessMessage(t("myaccount.apiKeyDeleted"), toast);
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setDeletingID(null);
		}
	};

	return (
		<>
			<AppDialog
				isOpen={isOpen}
				onClose={close}
				isCentered
				size="xl"
				title={t("admins.apiKeys.title", { username: admin?.username ?? "" })}
				footer={<Button onClick={close}>{t("close")}</Button>}
			>
				<Stack spacing={5}>
					<Text color="panel.textSecondary" fontSize="sm">
						{t("admins.apiKeys.description")}
					</Text>

					<Flex
						gap={2}
						align={{ base: "stretch", sm: "end" }}
						direction={{ base: "column", sm: "row" }}
					>
						<Box flex="1">
							<Text fontSize="sm" fontWeight="semibold" mb={2}>
								{t("myaccount.apiKeyLifetime")}
							</Text>
							<Select
								value={lifetime}
								onChange={(event) => setLifetime(event.target.value)}
							>
								<option value="1m">{t("myaccount.lifetime1m")}</option>
								<option value="3m">{t("myaccount.lifetime3m")}</option>
								<option value="6m">{t("myaccount.lifetime6m")}</option>
								<option value="12m">{t("myaccount.lifetime12m")}</option>
								<option value="forever">
									{t("myaccount.lifetimeForever")}
								</option>
							</Select>
						</Box>
						<Button
							colorScheme="primary"
							isLoading={creating}
							isDisabled={Boolean(generatedKey)}
							onClick={create}
							leftIcon={<KeyIcon width={17} />}
						>
							{t("admins.apiKeys.create")}
						</Button>
					</Flex>

					{generatedKey && (
						<Box
							borderWidth="1px"
							borderColor="orange.300"
							bg="orange.50"
							_dark={{ bg: "orange.900", borderColor: "orange.700" }}
							borderRadius="md"
							p={3}
						>
							<Text fontWeight="semibold" fontSize="sm" mb={2}>
								{t("admins.apiKeys.generated", {
									username: admin?.username ?? "",
								})}
							</Text>
							<HStack>
								<Input
									bg="panel.elevated"
									fontFamily="mono"
									value={generatedKey}
									isReadOnly
								/>
								<IconButton
									aria-label={t("copy")}
									icon={<ClipboardIcon width={18} />}
									onClick={async () => {
										await copyTextToClipboard(generatedKey);
										generateSuccessMessage(t("copied"), toast);
									}}
								/>
							</HStack>
							<Text
								color="orange.700"
								_dark={{ color: "orange.200" }}
								fontSize="xs"
								mt={2}
							>
								{t("myaccount.apiKeyWarning")}
							</Text>
						</Box>
					)}

					<Box>
						<Text fontWeight="semibold" mb={3}>
							{t("myaccount.apiKeys")}
						</Text>
						{loading ? (
							<Flex justify="center" py={6}>
								<Spinner size="sm" />
							</Flex>
						) : keys.length === 0 ? (
							<Text color="panel.textMuted" fontSize="sm">
								{t("myaccount.noApiKeys")}
							</Text>
						) : (
							<Stack
								spacing={0}
								borderWidth="1px"
								borderColor="panel.border"
								borderRadius="md"
								overflow="hidden"
							>
								{keys.map((key) => (
									<Flex
										key={key.id}
										align="center"
										justify="space-between"
										gap={3}
										px={3}
										py={2.5}
										borderBottomWidth="1px"
										borderColor="panel.border"
										_last={{ borderBottomWidth: 0 }}
									>
										<Box minW={0}>
											<Text
												fontFamily="mono"
												fontSize="sm"
												fontWeight="semibold"
											>
												{key.masked_key ?? "****"}
											</Text>
											<Text color="panel.textMuted" fontSize="xs" mt={1}>
												{t("myaccount.apiKeyCreatedAt")}:{" "}
												{dayjs(key.created_at).format("YYYY-MM-DD")} ·{" "}
												{t("myaccount.apiKeyExpiresAt")}:{" "}
												{key.expires_at
													? dayjs(key.expires_at).format("YYYY-MM-DD")
													: t("myaccount.never")}{" "}
												· {t("myaccount.lastUsed")}:{" "}
												{key.last_used_at
													? dayjs(key.last_used_at).format("YYYY-MM-DD HH:mm")
													: t("myaccount.neverUsed")}
											</Text>
										</Box>
										<IconButton
											aria-label={`${t("delete")} ${key.masked_key ?? "API key"}`}
											icon={<TrashIcon width={17} />}
											colorScheme="red"
											variant="ghost"
											size="sm"
											isLoading={deletingID === key.id}
											onClick={() => setKeyToDelete(key)}
										/>
									</Flex>
								))}
							</Stack>
						)}
					</Box>
				</Stack>
			</AppDialog>

			<ConfirmDialog
				isOpen={Boolean(keyToDelete)}
				onClose={() => setKeyToDelete(null)}
				onConfirm={remove}
				title={t("myaccount.deleteApiKey")}
				description={t("admins.apiKeys.confirmDelete", {
					key: keyToDelete?.masked_key ?? "****",
					username: admin?.username ?? "",
				})}
				confirmLabel={t("delete")}
				colorScheme="red"
				isLoading={deletingID !== null}
			/>
		</>
	);
};
