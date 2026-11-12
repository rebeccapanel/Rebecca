import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { RefreshCw, BookOpen, SquarePen, Plus, Power, Trash2 } from "lucide-react";

import { useDisclosure } from "hooks/useDisclosure";

import { HAProxyDialog } from "components/haproxy/HAProxyDialog";
import { cloneConfig, emptyConfig, errorText } from "components/haproxy/helpers";
import { OverviewBand } from "components/ui/overview-band";
import { SearchInput } from "components/common/SearchInput";
import { DEFAULT_SEARCH_MATCH_OPTIONS } from "utils/searchMatch";
import {
	DataTable,
	PageHeader,
	PageLoadingSkeleton,
	ResourceRefreshButton,
	type DataTableColumn,
	type DataTableRowAction,
} from "components/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
	createHAProxyConfig,
	deleteHAProxyConfig,
	getHAProxyOverview,
	type HAProxyConfig,
	updateHAProxyConfig,
} from "service/haproxy";

const palette = ["bg-panel-accent", "bg-panel-success", "bg-panel-info", "bg-panel-warning", "bg-panel-text-muted/60"];

export default function HAProxyPage() {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const navigate = useNavigate();
	
	const queryClient = useQueryClient();
	const dialog = useDisclosure();
	const [draft, setDraft] = useState<HAProxyConfig>(emptyConfig);
	const [deleteArmed, setDeleteArmed] = useState(0);
	const [search, setSearch] = useState("");
	const [searchMatch, setSearchMatch] = useState(DEFAULT_SEARCH_MATCH_OPTIONS);
	const overview = useQuery({ queryKey: ["haproxy-overview"], queryFn: getHAProxyOverview, refetchOnWindowFocus: false });
	const save = useMutation({
		mutationFn: (config: HAProxyConfig) => (config.id ? updateHAProxyConfig(config) : createHAProxyConfig(config)),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["haproxy-overview"] });
			dialog.onClose();
			toast.success(t("haproxy.saved"));
		},
		onError: (error) => {
			toast.error(t("haproxy.saveFailed"), { description: errorText(error) });
		},
	});
	const remove = useMutation({
		mutationFn: deleteHAProxyConfig,
		onSuccess: async () => {
			setDeleteArmed(0);
			await queryClient.invalidateQueries({ queryKey: ["haproxy-overview"] });
		},
		onError: (error) => {
			toast.error(errorText(error));
		},
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ config, enabled }: { config: HAProxyConfig; enabled: boolean }) =>
			updateHAProxyConfig({ ...cloneConfig(config), enabled }),
		onSuccess: async (_config, variables) => {
			await queryClient.invalidateQueries({ queryKey: ["haproxy-overview"] });
			toast.success(t("haproxy.toggleSaved", {
					status: t(variables.enabled ? "haproxy.enabled" : "disabled"),
				}));
		},
		onError: (error) => {
			toast.error(t("haproxy.saveFailed"), { description: errorText(error) });
		},
	});

	const configs = overview.data?.configs ?? [];
	const nodes = overview.data?.nodes ?? [];
	const visibleConfigs = configs.filter((config) => !search.trim() || config.name.toLowerCase().includes(search.trim().toLowerCase()));
	const listenerCount = (config: HAProxyConfig) =>
		config.targets.reduce((total, target) => total + target.listeners.length, 0);
	const targetCount = configs.reduce((total, config) => total + config.targets.length, 0);
	const enabledCount = configs.filter((config) => config.enabled).length;
	const rankedConfigs = [...configs].sort((a, b) => listenerCount(b) - listenerCount(a));
	const distributionSegments = rankedConfigs.slice(0, 4).map((config, index) => ({
		key: String(config.id),
		label: config.name,
		value: listenerCount(config),
		tone: palette[index],
	}));
	const otherListeners = rankedConfigs.slice(4).reduce((total, config) => total + listenerCount(config), 0);
	if (otherListeners) {
		distributionSegments.push({ key: "other", label: t("overview.other"), value: otherListeners, tone: palette[4] });
	}
	const overviewBand = {
		total: { label: t("haproxy.configurations"), value: configs.length, caption: `${t("haproxy.nodes")}: ${nodes.length}` },
		rows: [
			{ key: "enabled", label: t("haproxy.enabled"), value: enabledCount, tone: "bg-panel-success" },
			{ key: "targets", label: t("haproxy.targets"), value: targetCount, tone: "bg-panel-accent" },
		],
		distribution: { label: t("haproxy.listeners"), segments: distributionSegments },
		extra: {
			label: t("haproxy.listeners"),
			value: configs.reduce((total, config) => total + listenerCount(config), 0),
			caption: `${t("haproxy.targets")}: ${targetCount}`,
		},
	};

	const openCreate = () => {
		setDraft(emptyConfig());
		dialog.onOpen();
	};
	const openEdit = (config: HAProxyConfig) => {
		setDraft(cloneConfig(config));
		dialog.onOpen();
	};
	const tableColumns: DataTableColumn<HAProxyConfig>[] = [
		{
			id: "name",
			header: t("haproxy.name"),
			accessor: "name",
			isPrimary: true,
			priority: "primary",
			mobilePriority: 0,
		},
		{
			id: "enabled",
			sortValue: (config) => (config.enabled ? 1 : 0),
			header: t("haproxy.enabled"),
			priority: "high",
			width: "120px",
			mobilePriority: 1,
			cell: (config) => {
				const isToggling = toggleEnabled.isPending && toggleEnabled.variables?.config.id === config.id;
				const enabled = isToggling ? Boolean(toggleEnabled.variables?.enabled) : config.enabled;
				return <Badge className={toneClass(enabled ? "green" : "gray")}>{t(enabled ? "haproxy.enabled" : "disabled")}</Badge>;
			},
		},
		{
			id: "targets",
			header: t("haproxy.targets"),
			accessor: (config) => config.targets.length,
			priority: "high",
			width: "100px",
			mobilePriority: 2,
		},
		{
			id: "listeners",
			header: t("haproxy.listeners"),
			accessor: (config) => listenerCount(config),
			priority: "medium",
			width: "110px",
			mobilePriority: 3,
		},
		{
			id: "bindings",
			header: t("haproxy.bindings"),
			accessor: (config) =>
				config.targets
					.flatMap((target) =>
						target.listeners.map(
							(listener) => `${nodes.find((node) => node.id === target.node_id)?.name || target.node_id}:${listener.listen_port}`,
						),
					)
					.join(" · "),
			priority: "medium",
			multiline: true,
			mobilePriority: 4,
		},
	];
	const tableRowActions = (config: HAProxyConfig): DataTableRowAction<HAProxyConfig>[] => [
		{
			id: "toggle",
			label: t(config.enabled ? "haproxy.disableAction" : "haproxy.enableAction"),
			icon: <Power className="w-[16px]" />,
			disabled: toggleEnabled.isPending,
			onClick: () => toggleEnabled.mutate({ config, enabled: !config.enabled }),
		},
		{
			id: "edit",
			label: t("edit"),
			icon: <SquarePen className="w-[16px]" />,
			onClick: () => openEdit(config),
		},
		{
			id: "delete",
			label: deleteArmed === config.id ? t("haproxy.confirmDelete") : t("delete"),
			icon: <Trash2 className="w-[16px]" />,
			isDanger: true,
			disabled: remove.isPending,
			onClick: () => (deleteArmed === config.id ? remove.mutate(config.id) : setDeleteArmed(config.id)),
		},
	];

	if (overview.isLoading) {
		return <PageLoadingSkeleton />;
	}

	return (
		<div className="flex flex-col items-stretch gap-5">
			<PageHeader title={t("haproxy.title")} description={t("haproxy.description")} />
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand
					total={overviewBand.total}
					rows={overviewBand.rows}
					distribution={overviewBand.distribution}
					extra={overviewBand.extra}
					locale={locale}
				/>
					<div className="border-t border-panel-border! p-3">
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="min-w-0 flex-1">
								<SearchInput containerProps={{ className: "w-full md:w-[360px]" }} placeholder={t("search")} value={search} onChange={(event) => setSearch(event.target.value)} matchOptions={searchMatch} onMatchOptionsChange={setSearchMatch} />
							</div>
							<div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 md:flex md:shrink-0 md:flex-row md:justify-end">
								<Button onClick={() => navigate(`/tutorials?doc=${encodeURIComponent("admin/haproxy/")}`)} variant="outline" size="sm" className="w-full md:w-auto">
									<BookOpen className="w-[17px]" />
									{t("haproxy.tutorial")}
								</Button>
								<ResourceRefreshButton aria-label={t("refresh")} label={t("refresh")} icon={<RefreshCw className="w-[16px]" />} loading={overview.isFetching} onClick={() => void overview.refetch()} />
								<Button onClick={openCreate} size="sm" className="w-full md:w-auto">
									<Plus className="w-[17px]" />
									{t("haproxy.create")}
								</Button>
							</div>
						</div>
					</div>
				</div>

			<DataTable
				ariaLabel={t("haproxy.configurations")}
				data={visibleConfigs}
				columns={tableColumns}
				getRowId={(config) => String(config.id)}
				loading={overview.isLoading}
				loadingRows={5}
				error={overview.isError ? errorText(overview.error) : undefined}
				emptyState={<p className="text-center text-muted-foreground">{t("haproxy.empty")}</p>}
				rowActions={tableRowActions}
				actionsPlacement="end"
				actionsColumnWidth="60px"
				mobileBreakpoint="md"
			/>

			{overview.data ? (
				<HAProxyDialog
					open={dialog.isOpen}
					onClose={dialog.onClose}
					draft={draft}
					setDraft={setDraft}
					nodes={overview.data.nodes ?? []}
					templates={overview.data.templates ?? []}
					uploadedTemplates={overview.data.uploaded_templates ?? []}
					certificates={overview.data.certificates ?? []}
					onSave={() => save.mutate(draft)}
					isSaving={save.isPending}
				/>
			) : null}
		</div>
	);
}
