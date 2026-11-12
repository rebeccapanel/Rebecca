import { Alert } from "components/ui/alert";
import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Copy } from "lucide-react";

import { PanelSelect } from "components/common/PanelSelect";
import { OverviewBand } from "components/ui/overview-band";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { Switch as UiSwitch } from "components/ui/switch";

import { PageHeader, PageLoadingSkeleton } from "components/ui";
import { cn } from "lib/cn";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	getSubscriptionPlaceholderSettings,
	type SubscriptionPlaceholderSetting,
	updateSubscriptionPlaceholderSetting,
} from "service/settings";

const keyFor = (
	item: Pick<SubscriptionPlaceholderSetting, "admin_id" | "service_id">,
) => `${item.admin_id ?? "default"}:${item.service_id}`;

const VARIABLES = ["{USERNAME}", "{STATUS_TEXT}", "{DATA_USAGE}", "{DATA_LIMIT}", "{EXPIRE_DATE}"];

const PlaceholderSettingsPage = () => {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	
	const query = useQuery({ queryKey: ["subscription-placeholder-settings"], queryFn: getSubscriptionPlaceholderSettings, refetchOnWindowFocus: false });
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

	const overview = useMemo(() => {
		const enabled = items.filter((item) => item.enabled && !item.inherited).length;
		const inherited = items.filter((item) => item.inherited).length;
		const disabled = Math.max(items.length - enabled - inherited, 0);
		return {
			total: { label: t("placeholders.service"), value: items.length, caption: `${t("placeholders.admin")}: ${admins.length}` },
			rows: [
				{ key: "enabled", label: t("placeholders.enabled"), value: enabled, tone: "bg-panel-success" },
				{ key: "inherited", label: t("placeholders.inherit"), value: inherited, tone: "bg-panel-info" },
			],
			distribution: {
				label: t("placeholders.variables"),
				segments: [
					{ key: "enabled", label: t("placeholders.enabled"), value: enabled, tone: "bg-panel-success" },
					{ key: "inherited", label: t("placeholders.inherit"), value: inherited, tone: "bg-panel-info" },
					{ key: "disabled", label: t("status.disabled"), value: disabled, tone: "bg-panel-text-muted/60" },
				],
			},
			extra: { label: t("placeholders.serviceDefaults"), value: items.filter((item) => item.admin_id === null).length },
		};
	}, [items, admins.length, t]);

	const save = useMutation({ mutationFn: updateSubscriptionPlaceholderSetting, onSuccess: async (updated) => {
			setDraft(updated);
			setSelectedKey(keyFor(updated));
			await query.refetch();
			toast.success(t("placeholders.saved"), { duration: 2500 });
		},
		onError: (error: Error) => {
			toast.error(t("placeholders.saveFailed"), { description: error.message, duration: 5000 });
		}, });

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
			<Alert variant="destructive" className="rounded-xl">
				<CircleAlert className="size-4" aria-hidden="true" />
				{t("placeholders.loadFailed")}
			</Alert>
		);
	}

	return (
		<div className="flex flex-col gap-5 max-w-[1180px] mx-auto">
			<PageHeader title={t("placeholders.title")} description={t("placeholders.subtitle")} />

			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand
					total={overview.total}
					rows={overview.rows}
					distribution={overview.distribution}
					extra={overview.extra}
					locale={locale}
				/>
				{draft ? (
					<div className="border-t border-panel-border! p-3">
						<div className={cn("grid grid-cols-1 gap-3", query.data?.manage_all ? "md:grid-cols-2" : "md:grid-cols-1")}>
							{query.data?.manage_all && (
								<FormField label={t("placeholders.scope")}>
									<PanelSelect
										value={draft.admin_id === null ? "default" : String(draft.admin_id)}
										onValueChange={selectAdmin}
										options={[
											{ value: "default", label: t("placeholders.serviceDefaults") },
											...admins.map(([id, username]) => ({ value: String(id), label: username })),
										]}
									/>
								</FormField>
							)}
							<FormField label={t("placeholders.service")}>
								<PanelSelect
									value={String(draft.service_id)}
									onValueChange={selectService}
									options={adminItems.map((item) => ({
										value: String(item.service_id),
										label: item.service_name,
									}))}
								/>
							</FormField>
						</div>
					</div>
				) : null}
			</div>

			{!draft ? (
				<div className="rounded-xl border border-panel-border! bg-panel-surface py-14 text-center">
					<Copy style={{ margin: "0 auto" }} className="w-[42px]" />
					<h2 className="font-heading font-bold text-[1rem] leading-[1.2] mt-4">
						{t("placeholders.noServices")}
					</h2>
					<p className="text-panel-text-secondary mt-2">
						{t("placeholders.noServicesHint")}
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-5 rounded-xl border border-panel-border! bg-panel-surface p-4 md:p-5">
					{!draft.is_default && (
						<label className="flex items-center justify-between gap-4 rounded-lg border bg-card/40 px-3 py-2.5">
							<span className="min-w-0">
								<span className="block text-sm font-semibold">{t("placeholders.inherit")}</span>
								<span className="block text-xs text-muted-foreground mt-0.5">{t("placeholders.inheritHint")}</span>
							</span>
							<UiSwitch checked={draft.inherited} onCheckedChange={(next) => updateDraft("inherited", next)} />
						</label>
					)}

					<label className="flex items-center justify-between gap-4 rounded-lg border bg-card/40 px-3 py-2.5">
						<span className="min-w-0">
							<span className="block text-sm font-semibold">{t("placeholders.enabled")}</span>
							<span className="block text-xs text-muted-foreground mt-0.5">{t("placeholders.enabledHint")}</span>
						</span>
						<UiSwitch checked={draft.enabled} disabled={draft.inherited} onCheckedChange={(next) => updateDraft("enabled", next)} />
					</label>

					<div className="grid grid-cols-1 gap-4">
						<PlaceholderField label={t("placeholders.expired")} hint={t("placeholders.expiredHint")} value={draft.expired_remark} disabled={draft.inherited} dotClass="text-orange-400" onChange={(value) => updateDraft("expired_remark", value)} />
						<PlaceholderField label={t("placeholders.limited")} hint={t("placeholders.limitedHint")} value={draft.limited_remark} disabled={draft.inherited} dotClass="text-red-400" onChange={(value) => updateDraft("limited_remark", value)} />
						<PlaceholderField label={t("placeholders.disabled")} hint={t("placeholders.disabledHint")} value={draft.disabled_remark} disabled={draft.inherited} dotClass="text-gray-400" onChange={(value) => updateDraft("disabled_remark", value)} />
					</div>

					<div className="flex flex-col gap-2">
						<p className="text-sm font-semibold">{t("placeholders.variables")}</p>
						<div className="flex flex-wrap gap-1.5">
							{VARIABLES.map((variable) => (
								<code key={variable} className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
									{variable}
								</code>
							))}
						</div>
						<p className="text-xs text-muted-foreground">{t("placeholders.variablesHint")}</p>
					</div>

					<div className="flex justify-end">
						<Button onClick={() => save.mutate({ ...draft, inherit_default: draft.inherited })} loading={save.isPending}>
							{t("placeholders.save")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
};

const PlaceholderField = ({
	label,
	hint,
	dotClass,
	value,
	disabled: isDisabled,
	onChange,
}: {
	label: string;
	hint: string;
	dotClass?: string;
	value: string;
	disabled?: boolean;
	onChange: (value: string) => void;
}) => (
	<FormField
		label={
			<span className="inline-flex items-center gap-2">
				<span className={cn("size-2 rounded-full bg-current", dotClass)} />
				{label}
			</span>
		}
		description={hint}
	>
		<UiInput value={value} disabled={isDisabled} maxLength={255} onChange={(event) => onChange(event.target.value)} />
	</FormField>
);

export default PlaceholderSettingsPage;
