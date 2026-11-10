import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader, PageLoadingSkeleton, TabSystem } from "components/ui";
import { Alert } from "components/ui/alert";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { toast } from "components/ui/sonner";
import { Switch } from "components/ui/switch";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import { cn } from "lib/cn";
import {
	ArrowDown,
	ArrowUp,
	CircleAlert,
	CircleCheck,
	ArrowUpDown,
	Info,
	RotateCcw,
	Server,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getMyHosts,
	type MyHostsResponse,
	resetMyHosts,
	saveMyHosts,
} from "service/myhosts";

type HostDraft = { remark: string; enabled: boolean };
type Draft = {
	hosts: Record<number, HostDraft>;
	orders: Record<number, number[]>;
};

const draftFrom = (data: MyHostsResponse): Draft => ({
	hosts: Object.fromEntries(
		data.hosts.map((host) => [host.id, { remark: host.remark, enabled: host.enabled }]),
	),
	orders: Object.fromEntries(
		data.services.map((service) => [service.id, [...service.host_ids]]),
	),
});

const sameIDs = (left: number[], right: number[]) =>
	left.length === right.length && left.every((id, index) => id === right[index]);

const moveItem = (items: number[], from: number, to: number) => {
	if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
		return items;
	}
	const next = [...items];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
};

const MyHostsPage = () => {
	const { t } = useTranslation();
	const query = useQuery({
		queryKey: ["my-hosts"],
		queryFn: getMyHosts,
		refetchOnWindowFocus: false,
	});
	const [draft, setDraft] = useState<Draft | null>(null);
	const [serviceID, setServiceID] = useState<number | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);
	const [dragIndex, setDragIndex] = useState<number | null>(null);

	const data = query.data;
	useEffect(() => {
		if (data) setDraft(draftFrom(data));
	}, [data]);

	const services = data?.services ?? [];
	const service =
		services.find((item) => item.id === serviceID) ?? services[0] ?? null;
	const hostsByID = useMemo(
		() => new Map((data?.hosts ?? []).map((host) => [host.id, host])),
		[data],
	);

	const isDirty = useMemo(() => {
		if (!data || !draft) return false;
		const hostChanged = data.hosts.some((host) => {
			const current = draft.hosts[host.id];
			return (
				!current ||
				current.remark.trim() !== host.remark ||
				current.enabled !== host.enabled
			);
		});
		const orderChanged = data.services.some(
			(item) => !sameIDs(draft.orders[item.id] ?? [], item.host_ids),
		);
		return hostChanged || orderChanged;
	}, [data, draft]);

	const onSaved = (updated: MyHostsResponse) => {
		query.refetch();
		setDraft(draftFrom(updated));
	};
	const save = useMutation({
		mutationFn: saveMyHosts,
		onSuccess: (updated) => {
			onSaved(updated);
			toast.success(
				updated.active ? t("myHosts.saved") : t("myHosts.savedInactive"),
				{ duration: 3000 },
			);
		},
		onError: (error: Error) => {
			toast.error(t("myHosts.saveFailed"), {
				description: error.message,
				duration: 5000,
			});
		},
	});
	const reset = useMutation({
		mutationFn: resetMyHosts,
		onSuccess: (updated) => {
			onSaved(updated);
			setConfirmReset(false);
			toast.success(t("myHosts.resetDone"), { duration: 3000 });
		},
		onError: (error: Error) => {
			toast.error(t("myHosts.saveFailed"), {
				description: error.message,
				duration: 5000,
			});
		},
	});

	const updateHost = (id: number, patch: Partial<HostDraft>) =>
		setDraft((current) =>
			current
				? {
						...current,
						hosts: { ...current.hosts, [id]: { ...current.hosts[id], ...patch } },
					}
				: current,
		);
	const setOrder = (id: number, order: number[]) =>
		setDraft((current) =>
			current ? { ...current, orders: { ...current.orders, [id]: order } } : current,
		);

	const submit = () => {
		if (!data || !draft) return;
		save.mutate({
			hosts: data.hosts.map((host) => ({
				id: host.id,
				remark: (draft.hosts[host.id]?.remark ?? host.remark).trim(),
				enabled: draft.hosts[host.id]?.enabled ?? host.enabled,
			})),
			orders: data.services.map((item) => ({
				service_id: item.id,
				host_ids: draft.orders[item.id] ?? item.host_ids,
			})),
		});
	};

	if (query.isLoading || (data && !draft)) {
		return <PageLoadingSkeleton />;
	}
	if (query.isError || !data || !draft) {
		return (
			<Alert variant="destructive" className="rounded-xl">
				<CircleAlert className="size-4" aria-hidden="true" />
				{t("myHosts.loadFailed")}
			</Alert>
		);
	}

	const order = service ? (draft.orders[service.id] ?? service.host_ids) : [];
	const orderChanged = service ? !sameIDs(order, service.default_host_ids) : false;

	const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
		event.preventDefault();
		if (service && dragIndex !== null) {
			setOrder(service.id, moveItem(order, dragIndex, index));
		}
		setDragIndex(null);
	};

	return (
		<div className="flex flex-col gap-5 max-w-[1180px] mx-auto">
			<PageHeader
				title={t("myHosts.title")}
				description={t("myHosts.subtitle")}
				actions={
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							onClick={() => setConfirmReset(true)}
							disabled={!data.active || save.isPending}
						>
							<RotateCcw aria-hidden="true" />
							{t("myHosts.resetAll")}
						</Button>
						<Button onClick={submit} disabled={!isDirty} loading={save.isPending}>
							{t("myHosts.save")}
						</Button>
					</div>
				}
			/>

			<Alert className="rounded-xl">
				{data.active ? (
					<CircleCheck className="size-4 text-panel-success" aria-hidden="true" />
				) : (
					<Info className="size-4" aria-hidden="true" />
				)}
				<span>{data.active ? t("myHosts.statusActive") : t("myHosts.statusInactive")}</span>
			</Alert>

			{services.length === 0 || data.hosts.length === 0 ? (
				<div className="rounded-xl border border-panel-border! bg-panel-surface py-14 text-center">
					<Server style={{ margin: "0 auto" }} className="w-[42px]" />
					<h2 className="font-heading font-bold text-[1rem] leading-[1.2] mt-4">
						{t("myHosts.empty")}
					</h2>
					<p className="text-panel-text-secondary mt-2">{t("myHosts.emptyHint")}</p>
				</div>
			) : (
				<div className="flex flex-col rounded-xl border border-panel-border! bg-panel-surface overflow-hidden">
					{services.length > 1 && (
						<div className="border-b border-panel-border!">
							<TabSystem
								tabs={services.map((item) => ({
									value: String(item.id),
									label: item.name || `#${item.id}`,
									isActive: item.id === service?.id,
									onClick: () => setServiceID(item.id),
								}))}
							/>
						</div>
					)}
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
						<p className="text-xs text-panel-text-muted">{t("myHosts.orderHint")}</p>
						{service && (
							<Button
								variant="ghost"
								size="sm"
								disabled={!orderChanged}
								onClick={() => setOrder(service.id, [...service.default_host_ids])}
							>
								<RotateCcw aria-hidden="true" />
								{t("myHosts.restoreOrder")}
							</Button>
						)}
					</div>
					<ol className="flex flex-col gap-2 p-4">
						{order.map((hostID, index) => {
							const host = hostsByID.get(hostID);
							const current = draft.hosts[hostID];
							if (!host || !current) return null;
							const renamed =
								current.remark.trim() !== "" &&
								current.remark.trim() !== host.default_remark;
							return (
								<li
									key={hostID}
									draggable
									onDragStart={() => setDragIndex(index)}
									onDragEnd={() => setDragIndex(null)}
									onDragOver={(event) => event.preventDefault()}
									onDrop={(event) => onDrop(event, index)}
									className={cn(
										"flex flex-col gap-3 rounded-lg border bg-card/40 px-3 py-2.5 md:flex-row md:items-center",
										!current.enabled && "opacity-60",
										dragIndex === index && "border-panel-accent!",
									)}
								>
									<div className="flex items-center gap-1 shrink-0">
										<ArrowUpDown
											className="size-4 cursor-grab text-panel-text-muted"
											aria-hidden="true"
										/>
										<span className="w-6 text-center text-xs tabular-nums text-panel-text-muted">
											{index + 1}
										</span>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t("myHosts.moveUp")}
											disabled={index === 0}
											onClick={() => service && setOrder(service.id, moveItem(order, index, index - 1))}
										>
											<ArrowUp aria-hidden="true" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t("myHosts.moveDown")}
											disabled={index === order.length - 1}
											onClick={() => service && setOrder(service.id, moveItem(order, index, index + 1))}
										>
											<ArrowDown aria-hidden="true" />
										</Button>
									</div>
									<div className="flex min-w-0 flex-1 flex-col gap-1">
										<Input
											value={current.remark}
											placeholder={host.default_remark}
											maxLength={256}
											aria-label={t("myHosts.remark")}
											onChange={(event) => updateHost(hostID, { remark: event.target.value })}
										/>
										<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-panel-text-muted">
											<span className="truncate" dir="ltr">
												{host.address || "—"}
											</span>
											<Badge variant="outline" className="font-mono" dir="ltr">
												{host.inbound_tag}
											</Badge>
											{renamed && (
												<span className="truncate">
													{t("myHosts.mainName")}: <bdi>{host.default_remark}</bdi>
												</span>
											)}
										</div>
									</div>
									<div className="flex items-center justify-end gap-2 shrink-0">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t("myHosts.restoreName")}
											title={t("myHosts.restoreName")}
											disabled={!renamed}
											onClick={() => updateHost(hostID, { remark: host.default_remark })}
										>
											<RotateCcw aria-hidden="true" />
										</Button>
										<span className="text-xs text-panel-text-muted">
											{current.enabled ? t("myHosts.shown") : t("myHosts.hidden")}
										</span>
										<Switch
											checked={current.enabled}
											aria-label={t("myHosts.enabled")}
											onCheckedChange={(enabled: boolean) => updateHost(hostID, { enabled })}
										/>
									</div>
								</li>
							);
						})}
					</ol>
				</div>
			)}

			<ConfirmDialog
				open={confirmReset}
				title={t("myHosts.resetTitle")}
				description={t("myHosts.resetDescription")}
				confirmLabel={t("myHosts.resetAll")}
				colorScheme="red"
				loading={reset.isPending}
				onClose={() => {
					if (!reset.isPending) setConfirmReset(false);
				}}
				onConfirm={() => reset.mutate()}
			/>
		</div>
	);
};

export default MyHostsPage;
