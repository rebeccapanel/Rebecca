import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Spinner } from "components/ui/spinner";
import { toast } from "components/ui/sonner";
import { cn } from "lib/cn";
import { Clipboard, Key, Trash2 } from "lucide-react";

import { AppDialog } from "components/dialogs/AppDialog";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import { PanelSelect as Select } from "components/common/PanelSelect";
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
	open: boolean;
	onClose: () => void;
};

export const AdminApiKeysDialog = ({ admin, open: isOpen, onClose }: Props) => {
	const { t } = useTranslation();
	
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
				open={isOpen}
				onClose={close}
				size="xl"
				title={t("admins.apiKeys.title", { username: admin?.username ?? "" })}
				footer={<Button onClick={close}>{t("close")}</Button>}
			>
				<div className="flex flex-col gap-5">
					<p className="text-panel-text-secondary text-[0.875rem]">
						{t("admins.apiKeys.description")}
					</p>

					<div className="flex-col sm:flex-row flex gap-2 items-stretch sm:items-end">
						<div className="flex-1">
							<p className="text-[0.875rem] font-semibold mb-2">
								{t("myaccount.apiKeyLifetime")}
							</p>
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
						</div>
						<Button disabled={Boolean(generatedKey)} onClick={create} loading={creating}>{<Key className="w-[17px]" />}
							{t("admins.apiKeys.create")}
						</Button>
					</div>

					{generatedKey && (
						<div className="border border-orange-300! bg-orange-50 dark:bg-orange-900 dark:border-orange-700! rounded-md p-3">
							<p className="font-semibold text-[0.875rem] mb-2">
								{t("admins.apiKeys.generated", {
									username: admin?.username ?? "",
								})}
							</p>
							<div className="flex flex-row items-center gap-2">
								<Input value={generatedKey} readOnly className="bg-panel-elevated font-mono" />
								<Button aria-label={t("copy")} onClick={async () => {
										await copyTextToClipboard(generatedKey);
										generateSuccessMessage(t("copied"), toast);
									}} className="size-9 p-0">{<Clipboard className="w-[18px]" />}</Button>
							</div>
							<p className="text-orange-700 dark:text-orange-200 text-[0.75rem] mt-2">
								{t("myaccount.apiKeyWarning")}
							</p>
						</div>
					)}

					<div>
						<p className="font-semibold mb-3">
							{t("myaccount.apiKeys")}
						</p>
						{loading ? (
							<div className="flex justify-center py-6">
								<Spinner />
							</div>
						) : keys.length === 0 ? (
							<p className="text-panel-text-muted text-[0.875rem]">
								{t("myaccount.noApiKeys")}
							</p>
						) : (
							<div className="flex flex-col gap-0 border border-panel-border! rounded-md overflow-hidden">
								{keys.map((key) => (
									<div key={key.id} className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-panel-border! last:border-b-0">
										<div className="min-w-0!">
											<p className="font-mono text-[0.875rem] font-semibold">
												{key.masked_key ?? "****"}
											</p>
											<p className="text-panel-text-muted text-[0.75rem] mt-1">
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
											</p>
										</div>
										<Button aria-label={`${t("delete")} ${key.masked_key ?? "API key"}`} onClick={() => setKeyToDelete(key)} variant="ghost" size="sm" loading={deletingID === key.id} className="text-destructive hover:bg-destructive/10 size-8 p-0">{<Trash2 className="w-[17px]" />}</Button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</AppDialog>

			<ConfirmDialog
				open={Boolean(keyToDelete)}
				onClose={() => setKeyToDelete(null)}
				onConfirm={remove}
				title={t("myaccount.deleteApiKey")}
				description={t("admins.apiKeys.confirmDelete", {
					key: keyToDelete?.masked_key ?? "****",
					username: admin?.username ?? "",
				})}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={deletingID !== null}
			/>
		</>
	);
};
