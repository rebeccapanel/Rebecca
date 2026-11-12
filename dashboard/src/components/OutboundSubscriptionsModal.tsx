import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Switch } from "components/ui/switch";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Spinner } from "components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Dialog } from "components/ui/dialog";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";
import { ArrowDown, RefreshCw, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";

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
	open: boolean;
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
	open: isOpen,
	onClose,
	onChanged,
}) => {
	const { t } = useTranslation();
	
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
			toast.error(parseAPIError(
					error,
					t("pages.xray.outboundSub.toastLoadFailed"),
				));
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
			toast.warning(t("pages.xray.outboundSub.toastUrlRequired"));
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
				toast.success(editingID === null
							? t("pages.xray.outboundSub.toastAdded")
							: t("pages.xray.outboundSub.toastUpdated"));
				resetForm();
				await notifyChanged();
			}
		} catch (error: any) {
			toast.error(parseAPIError(
					error,
					t("pages.xray.outboundSub.toastAddFailed"),
				));
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
			toast.error(parseAPIError(
					error,
					t("pages.xray.outboundSub.previewEmpty"),
				));
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
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent className="mx-3">
				<XrayModalHeader>
					{t("pages.xray.outboundSub.title")}
				</XrayModalHeader>
				
				<XrayModalBody>
					<div className="flex flex-col items-stretch gap-4">
						<div className="xray-section">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
								<Field>
									<FieldLabel>{t("hostsDialog.remark")}</FieldLabel>
									<Input value={form.remark} onChange={(event) =>
											setForm((prev) => ({ ...prev, remark: event.target.value }))
										} />
								</Field>
								<Field>
									<FieldLabel>{t("pages.xray.outboundSub.url")}</FieldLabel>
									<Input value={form.url} onChange={(event) =>
											setForm((prev) => ({ ...prev, url: event.target.value }))
										} />
								</Field>
								<Field>
									<FieldLabel>{t("pages.xray.tor.tagPrefix")}</FieldLabel>
									<Input value={form.tagPrefix} onChange={(event) =>
											setForm((prev) => ({ ...prev, tagPrefix: event.target.value }))
										} />
									<FieldDescription>
										{t("pages.xray.outboundSub.tagPrefixHint")}
									</FieldDescription>
								</Field>
								<Field>
									<FieldLabel>{t("pages.xray.outboundSub.interval")}</FieldLabel>
									<Input type="number" min={1} value={intervalMinutes} onChange={(event) =>
											setForm((prev) => ({
												...prev,
												updateInterval: Math.max(60, Number(event.target.value || 10) * 60),
											}))
										} />
									<FieldDescription>
										{t("pages.xray.outboundSub.intervalHint")}
									</FieldDescription>
								</Field>
							</div>
							<div className="flex flex-row items-center mt-3 gap-5 flex-wrap">
								<div className="flex flex-row items-center gap-2">
									<Switch checked={form.enabled} onCheckedChange={(checked: boolean) => setForm((prev) => ({ ...prev, enabled: checked }))} />
									<p className="text-[0.875rem]">{t("nodes.enabled")}</p>
								</div>
								<div className="flex flex-row items-center gap-2">
									<Switch checked={form.prepend} onCheckedChange={(checked: boolean) => setForm((prev) => ({ ...prev, prepend: checked }))} />
									<p className="text-[0.875rem]">{t("pages.xray.outboundSub.prepend")}</p>
								</div>
								<div className="flex flex-row items-center gap-2">
									<Switch checked={form.allowPrivate} onCheckedChange={(checked: boolean) => setForm((prev) => ({ ...prev, allowPrivate: checked }))} />
									<p className="text-[0.875rem]">{t("pages.xray.outboundSub.allowPrivate")}</p>
								</div>
							</div>
							{preview.length > 0 && (
								<div className="flex flex-wrap mt-3 gap-2">
									{preview.map((item, index) => (
										<div key={`${item.tag}-${index}`}>
											<Badge className="bg-green-600 text-white">
												{item.tag || "-"} · {item.protocol || "-"}
											</Badge>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="xray-section">
							<div className="flex flex-row items-center gap-2 justify-between mb-3">
								<div>
									<p className="font-semibold">
										{t("pages.xray.outboundSub.active")}
									</p>
									<p className="text-gray-500 text-[0.75rem]">
										{t("pages.xray.outboundSub.restartHint")}
									</p>
								</div>
								<Button onClick={load} variant="ghost" size="xs" loading={loading}>{<RefreshCw className="w-[14px]" />}
									{t("refresh")}
								</Button>
							</div>
							<hr className="mb-3 w-full border-0 border-b border-panel-border! opacity-60" />
							{loading ? (
								<div className="flex flex-row items-center gap-2 justify-center py-6">
									<Spinner />
								</div>
							) : items.length === 0 ? (
								<p className="text-gray-500 text-[0.875rem]">
									{t("pages.xray.outboundSub.empty")}
								</p>
							) : (
								<table className="w-full border-separate border-spacing-0">
									<thead>
										<tr>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text w-[70px]">#</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("hostsDialog.remark")}</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("pages.xray.Outbounds")}</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("status")}</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("nodes.enabled")}</th>
											<th className="bg-panel-elevated px-6 py-3 text-start text-[0.75rem] font-bold uppercase leading-4 tracking-wider text-panel-text">{t("actions")}</th>
										</tr>
									</thead>
									<tbody>
										{items.map((item, index) => (
											<tr key={item.id}>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<div className="flex flex-row items-center gap-0">
														<Button aria-label={t("a11y.moveUp")} disabled={index === 0 || busyID === item.id} onClick={() => move(item.id, "up")} variant="ghost" size="xs" className="size-7 p-0">{<ArrowUp className="w-[14px]" />}</Button>
														<Button aria-label={t("a11y.moveDown")} disabled={index === items.length - 1 || busyID === item.id} onClick={() => move(item.id, "down")} variant="ghost" size="xs" className="size-7 p-0">{<ArrowDown className="w-[14px]" />}</Button>
													</div>
												</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text max-w-[260px]">
													<p className="font-semibold truncate">
														<AppleEmojiText>
															{item.remark || item.url || ""}
														</AppleEmojiText>
													</p>
													<p className="text-gray-500 text-[0.75rem] truncate">
														{item.tagPrefix || "sub-"} · {item.url}
													</p>
												</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">{item.outboundCount ?? 0}</Badge>
												</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													{item.lastError ? (
														<Tooltip>
<TooltipTrigger asChild>
															<Badge className="bg-destructive/10 text-destructive">error</Badge>
														</TooltipTrigger>
<TooltipContent>{item.lastError}</TooltipContent>
</Tooltip>
													) : (
														<Badge className="bg-green-600 text-white">
															{item.lastUpdated
																? new Date(item.lastUpdated * 1000).toLocaleString()
																: t("myaccount.never")}
														</Badge>
													)}
												</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<Switch checked={!!item.enabled} disabled={busyID === item.id} onCheckedChange={() => toggle(item)} />
												</td>
												<td className="px-6 py-4 text-[0.875rem] leading-5 text-panel-text">
													<div className="flex flex-row items-center gap-1">
														<Button onClick={() => edit(item)} variant="ghost" size="xs">
															{t("edit")}
														</Button>
														<Button aria-label={t("refresh")} onClick={() => refreshOne(item.id)} variant="ghost" size="xs" loading={busyID === item.id} className="size-7 p-0">{<RefreshCw className="w-[14px]" />}</Button>
														<Button aria-label={t("delete")} disabled={busyID === item.id} onClick={() => deleteOne(item.id)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10 size-7 p-0">{<Trash2 className="w-[14px]" />}</Button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</XrayModalBody>
				<XrayModalFooter>
					<div className="flex flex-row items-center w-full justify-between gap-2 flex-wrap">
						<div>
							{editingID !== null && (
								<Button onClick={resetForm} variant="ghost" size="sm">
									{t("cancel")}
								</Button>
							)}
						</div>
						<div className="flex flex-row items-center gap-2 flex-wrap">
							<Button onClick={previewURL} variant="ghost" size="sm" loading={previewing}>{<Eye className="w-[16px]" />}
								{t("bulkActions.preview")}
							</Button>
							<Button onClick={save} size="sm" loading={saving}>{<Plus className="w-[16px]" />}
								{editingID === null ? t("add") : t("save")}
							</Button>
							<Button onClick={onClose} variant="ghost" size="sm">
								{t("close")}
							</Button>
						</div>
					</div>
				</XrayModalFooter>
			</XrayModalContent>
		</Dialog>
	);
};
