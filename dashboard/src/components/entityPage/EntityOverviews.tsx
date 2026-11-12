import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NodeType } from "contexts/NodesContext";
import { Button } from "components/ui/button";
import { fetch } from "service/http";
import type { Admin } from "types/Admin";
import type { User } from "types/User";
import type { ServiceAdminUsageResponse } from "types/Service";
import type { RawInbound } from "utils/inbounds";
import { formatBytes } from "utils/formatByte";
import {
	type EntityPageInfo,
	type EntityTone,
	OverviewChart,
	OverviewChartSkeleton,
	OverviewEmpty,
	OverviewFacts,
	OverviewLayout,
	OverviewPanel,
	OverviewRankedBars,
	OverviewStat,
	StatusBadge,
	formatChartLabel,
	usageRangeQuery,
} from "./EntityPageParts";

type UsageResponse = {
	usages?: Array<{ date?: string; used_traffic?: number }>;
};

const USAGE_DAYS = 14;

const percent = (value: number) => `${Math.round(value)}%`;

const meterPercent = (used: number, limit: number) =>
	limit > 0 ? (used / limit) * 100 : undefined;

const formatDate = (value: number | null | undefined) =>
	value ? dayjs.unix(value).format("MMM D, YYYY") : null;

const formatDuration = (seconds: number | null | undefined) => {
	if (!seconds) return "–";
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
};

const capitalize = (value: string | null | undefined) =>
	value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : "–";

const display = (value: unknown) =>
	value === null || value === undefined || value === "" ? "–" : String(value);

const useUsageSeries = (path: string) => {
	const query = useQuery({
		queryKey: ["entity-page-usage", path],
		queryFn: () =>
			fetch<UsageResponse>(path, { query: usageRangeQuery(USAGE_DAYS) }),
		staleTime: 60_000,
	});
	const usages = query.data?.usages ?? [];
	return {
		pending: query.isPending,
		categories: usages.map((point) => formatChartLabel(point.date ?? "")),
		values: usages.map((point) => Number(point.used_traffic ?? 0)),
	};
};

const useLiveSamples = (node: NodeType) => {
	const [samples, setSamples] = useState<
		Array<{ time: string; cpu: number; memory: number }>
	>([]);
	useEffect(() => {
		setSamples((previous) => [
			...previous.slice(-59),
			{
				time: dayjs().format("HH:mm:ss"),
				cpu: node.cpu_usage_percent ?? 0,
				memory: node.memory_usage_percent ?? 0,
			},
		]);
	}, [node]);
	return samples;
};

const nodeTone = (status: string | null | undefined): EntityTone => {
	if (status === "connected") return "good";
	if (status === "error") return "bad";
	if (status === "connecting" || status === "limited") return "warn";
	return "muted";
};

const xrayTone = (status: string | null | undefined): EntityTone => {
	if (status === "running") return "good";
	if (status === "stopped") return "bad";
	return "muted";
};

const userTone = (status: string): EntityTone => {
	if (status === "active") return "good";
	if (status === "expired") return "bad";
	if (status === "disabled") return "muted";
	return "warn";
};

const NodeOverview = ({ node }: { node: NodeType }) => {
	const { t } = useTranslation();
	const samples = useLiveSamples(node);
	const traffic = useUsageSeries(`/node/${node.id}/usage/daily`);
	const cpu = node.cpu_usage_percent ?? 0;
	const memory = node.memory_usage_percent ?? 0;

	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat
						label={t("entityPages.cpu", "CPU")}
						value={percent(cpu)}
						hint={`${node.cpu_cores ?? "–"} ${t("entityPages.cores", "cores")}`}
						meter={cpu}
					/>
					<OverviewStat
						label={t("entityPages.memory", "Memory")}
						value={percent(memory)}
						hint={`${formatBytes(node.memory_used ?? 0)} / ${formatBytes(node.memory_total ?? 0)}`}
						meter={memory}
					/>
					<OverviewStat
						label={t("entityPages.xray", "Xray")}
						value={capitalize(node.xray_status)}
						hint={`${t("entityPages.version", "Version")} ${node.xray_version ?? "–"}`}
					/>
					<OverviewStat
						label={t("entityPages.uptime", "Uptime")}
						value={formatDuration(node.uptime_seconds)}
						hint={`${t("entityPages.xrayUptime", "Xray uptime")} ${formatDuration(node.xray_uptime_seconds)}`}
					/>
				</>
			}
			main={
				<>
					<OverviewPanel
						title={t("entityPages.cpuAndMemory", "CPU and memory")}
						description={t(
							"entityPages.liveHint",
							"Samples collected while this page is open",
						)}
					>
						{samples.length > 2 ? (
							<OverviewChart
								type="line"
								categories={samples.map((sample) => sample.time)}
								series={[
									{ name: t("entityPages.cpu", "CPU"), data: samples.map((s) => s.cpu) },
									{
										name: t("entityPages.memory", "Memory"),
										data: samples.map((s) => s.memory),
									},
								]}
								formatter={percent}
							/>
						) : (
							<OverviewChartSkeleton />
						)}
					</OverviewPanel>
					<OverviewPanel
						title={t("entityPages.traffic", "Traffic")}
						description={t("entityPages.lastDays", "Last {{count}} days", { count: USAGE_DAYS })}
					>
						{traffic.pending ? (
							<OverviewChartSkeleton />
						) : traffic.values.some((value) => value > 0) ? (
							<OverviewChart
								type="area"
								categories={traffic.categories}
								series={[{ name: t("entityPages.traffic", "Traffic"), data: traffic.values }]}
								formatter={(value) => formatBytes(value, 1)}
							/>
						) : (
							<OverviewEmpty>{t("entityPages.noUsage", "No usage in this range")}</OverviewEmpty>
						)}
					</OverviewPanel>
				</>
			}
			aside={
				<>
					<OverviewPanel title={t("entityPages.details", "Details")}>
						<OverviewFacts
							items={[
								{ label: t("entityPages.address", "Address"), value: node.address },
								{ label: t("entityPages.port", "Port"), value: node.port },
								{ label: t("entityPages.apiPort", "API port"), value: display(node.api_port) },
								{ label: t("entityPages.controlPort", "Control port"), value: display(node.control_port) },
								{
									label: t("entityPages.usageCoefficient", "Usage coefficient"),
									value: `×${node.usage_coefficient ?? 1}`,
								},
								{
									label: t("entityPages.cpuFrequency", "CPU frequency"),
									value: node.cpu_frequency_hz
										? `${(node.cpu_frequency_hz / 1e9).toFixed(2)} GHz`
										: "–",
								},
								{
									label: t("entityPages.memoryTotal", "Memory total"),
									value: formatBytes(node.memory_total ?? 0),
								},
								{
									label: t("entityPages.proxy", "Proxy"),
									value: node.proxy_enabled
										? `${node.proxy_type ?? ""} ${node.proxy_host ?? ""}:${node.proxy_port ?? ""}`
										: t("entityPages.off", "Off"),
								},
							]}
						/>
					</OverviewPanel>
					<OverviewPanel title={t("entityPages.health", "Health")}>
						<OverviewFacts
							items={[
								{
									label: t("entityPages.nodeStatus", "Node"),
									value: <StatusBadge tone={nodeTone(node.status)}>{capitalize(node.status)}</StatusBadge>,
								},
								{
									label: t("entityPages.agent", "Agent"),
									value: <StatusBadge tone={nodeTone(node.agent_status)}>{capitalize(node.agent_status)}</StatusBadge>,
								},
								{
									label: t("entityPages.xray", "Xray"),
									value: <StatusBadge tone={xrayTone(node.xray_status)}>{capitalize(node.xray_status)}</StatusBadge>,
								},
								{
									label: t("entityPages.version", "Version"),
									value: display(node.xray_version),
								},
								{
									label: t("entityPages.uptime", "Uptime"),
									value: formatDuration(node.uptime_seconds),
								},
							]}
						/>
					</OverviewPanel>
				</>
			}
		/>
	);
};

const AdminOverview = ({ admin }: { admin: Admin }) => {
	const { t } = useTranslation();
	const traffic = useUsageSeries(`/admin/${encodeURIComponent(admin.username)}/usage/daily`);
	const allocated = admin.data_limit_allocated ?? 0;
	const dataLimit = admin.data_limit ?? 0;

	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat
						label={t("entityPages.users", "Users")}
						value={admin.users_count ?? 0}
						hint={`${admin.active_users ?? 0} ${t("entityPages.active", "active")} · ${admin.online_users ?? 0} ${t("entityPages.online", "online")}`}
					/>
					<OverviewStat
						label={t("entityPages.usedTraffic", "Used traffic")}
						value={formatBytes(admin.users_usage ?? 0)}
						hint={`${t("entityPages.lifetime", "Lifetime")} ${formatBytes(admin.lifetime_usage ?? 0)}`}
						meter={meterPercent(admin.users_usage ?? 0, dataLimit)}
					/>
					<OverviewStat
						label={t("entityPages.dataLimit", "Data limit")}
						value={dataLimit > 0 ? formatBytes(dataLimit) : t("entityPages.unlimited", "Unlimited")}
						hint={`${formatBytes(allocated)} ${t("entityPages.allocated", "allocated")}`}
						meter={meterPercent(allocated, dataLimit)}
					/>
					<OverviewStat
						label={t("entityPages.role", "Role")}
						value={capitalize(admin.role)}
						hint={`${t("entityPages.status", "Status")}: ${capitalize(admin.status)}`}
					/>
				</>
			}
			main={
				<OverviewPanel
					title={t("entityPages.traffic", "Traffic")}
					description={t("entityPages.lastDays", "Last {{count}} days", { count: USAGE_DAYS })}
				>
					{traffic.pending ? (
						<OverviewChartSkeleton />
					) : traffic.values.some((value) => value > 0) ? (
						<OverviewChart
							type="area"
							categories={traffic.categories}
							series={[{ name: t("entityPages.traffic", "Traffic"), data: traffic.values }]}
							formatter={(value) => formatBytes(value, 1)}
						/>
					) : (
						<OverviewEmpty>{t("entityPages.noUsage", "No usage in this range")}</OverviewEmpty>
					)}
				</OverviewPanel>
			}
			aside={
				<>
					<OverviewPanel
						title={t("entityPages.usersByStatus", "Users by status")}
						description={t("entityPages.usersByStatusHint", "Accounts created by this admin")}
					>
						<OverviewRankedBars
							format={(value) => String(value)}
							empty={t("entityPages.noUsage", "No usage in this range")}
							items={[
								{ label: t("entityPages.active", "Active"), value: admin.active_users ?? 0 },
								{ label: t("entityPages.limited", "Limited"), value: admin.limited_users ?? 0 },
								{ label: t("entityPages.expired", "Expired"), value: admin.expired_users ?? 0 },
								{ label: t("entityPages.onHold", "On hold"), value: admin.on_hold_users ?? 0 },
								{ label: t("entityPages.disabled", "Disabled"), value: admin.disabled_users ?? 0 },
							]}
						/>
					</OverviewPanel>
					<OverviewPanel title={t("entityPages.details", "Details")}>
						<OverviewFacts
							items={[
								{ label: t("entityPages.telegramId", "Telegram ID"), value: display(admin.telegram_id) },
								{
									label: t("entityPages.trafficLimitMode", "Traffic limit mode"),
									value: capitalize(admin.traffic_limit_mode),
								},
								{
									label: t("entityPages.usersLimit", "Users limit"),
									value: admin.users_limit ?? t("entityPages.unlimited", "Unlimited"),
								},
								{
									label: t("entityPages.expires", "Expires"),
									value: formatDate(admin.expire) ?? t("entityPages.never", "Never"),
								},
								{
									label: t("entityPages.showUserTraffic", "Show user traffic"),
									value: admin.show_user_traffic ? t("entityPages.yes", "Yes") : t("entityPages.no", "No"),
								},
								{
									label: t("entityPages.deletedUsersUsage", "Deleted users usage"),
									value: formatBytes(admin.deleted_users_usage ?? 0),
								},
							]}
						/>
					</OverviewPanel>
				</>
			}
		/>
	);
};

const UserOverview = ({ user }: { user: User }) => {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const copySubscription = () => {
		void navigator.clipboard?.writeText(user.subscription_url).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		});
	};
	const expires = formatDate(user.expire);
	const daysLeft = user.expire ? dayjs.unix(user.expire).diff(dayjs(), "day") : null;

	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat
						label={t("entityPages.usedTraffic", "Used traffic")}
						value={formatBytes(user.used_traffic ?? 0)}
						hint={
							user.data_limit
								? `${t("entityPages.of", "of")} ${formatBytes(user.data_limit)}`
								: t("entityPages.noLimit", "No limit")
						}
						meter={meterPercent(user.used_traffic ?? 0, user.data_limit ?? 0)}
					/>
					<OverviewStat
						label={t("entityPages.expires", "Expires")}
						value={expires ?? t("entityPages.never", "Never")}
						hint={
							daysLeft === null
								? t("entityPages.noExpiry", "No expiry date")
								: `${daysLeft} ${t("entityPages.daysLeft", "days left")}`
						}
					/>
					<OverviewStat
						label={t("entityPages.status", "Status")}
						value={capitalize(user.status)}
						hint={`${t("entityPages.lifetime", "Lifetime")} ${formatBytes(user.lifetime_used_traffic ?? 0)}`}
					/>
					<OverviewStat
						label={t("entityPages.online", "Online")}
						value={user.online_at ? dayjs(user.online_at).format("MMM D, HH:mm") : t("entityPages.never", "Never")}
						hint={user.service_name ?? t("entityPages.noService", "No service")}
					/>
				</>
			}
			main={
				<>
					<OverviewPanel
						title={t("entityPages.subscription", "Subscription")}
						description={t("entityPages.subscriptionHint", "Link the client uses to fetch configs")}
						action={
							<Button variant="outline" size="sm" onClick={copySubscription}>
								{copied ? t("entityPages.copied", "Copied") : t("entityPages.copyLink", "Copy link")}
							</Button>
						}
					>
						<p className="break-all rounded-md border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">
							{user.subscription_url}
						</p>
					</OverviewPanel>
					{user.note ? (
						<OverviewPanel title={t("entityPages.note", "Note")}>
							<p className="whitespace-pre-wrap text-sm text-muted-foreground">{user.note}</p>
						</OverviewPanel>
					) : null}
				</>
			}
			aside={
				<OverviewPanel title={t("entityPages.details", "Details")}>
					<OverviewFacts
						items={[
							{ label: t("entityPages.service", "Service"), value: user.service_name ?? "–" },
							{ label: t("entityPages.admin", "Admin"), value: user.admin_username ?? "–" },
							{
								label: t("entityPages.resetStrategy", "Reset strategy"),
								value: capitalize(user.data_limit_reset_strategy),
							},
						]}
					/>
				</OverviewPanel>
			}
		/>
	);
};

type ServiceFacts = {
	id: number;
	name: string;
	description?: string | null;
	user_count?: number | null;
	host_count?: number | null;
	used_traffic?: number | null;
	lifetime_used_traffic?: number | null;
	usage_coefficient?: number | null;
	broken?: boolean | null;
};

const ServiceStatus = ({ service }: { service: ServiceFacts }) => {
	const { t } = useTranslation();
	return (
		<StatusBadge tone={service.broken ? "bad" : "good"}>
			{service.broken ? t("entityPages.broken", "Broken") : t("entityPages.healthy", "Healthy")}
		</StatusBadge>
	);
};

const ServiceOverview = ({ service }: { service: ServiceFacts }) => {
	const { t } = useTranslation();
	const adminUsage = useQuery({
		queryKey: ["entity-page-service-admins", service.id],
		queryFn: () =>
			fetch<ServiceAdminUsageResponse>(`/v2/services/${service.id}/usage/admins`, {
				query: usageRangeQuery(30),
			}),
		staleTime: 60_000,
	});
	const admins = (adminUsage.data?.admins ?? [])
		.map((item) => ({ label: item.username, value: item.used_traffic }))
		.sort((a, b) => b.value - a.value);

	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat label={t("entityPages.users", "Users")} value={service.user_count ?? 0} />
					<OverviewStat label={t("entityPages.hosts", "Hosts")} value={service.host_count ?? 0} />
					<OverviewStat
						label={t("entityPages.usedTraffic", "Used traffic")}
						value={formatBytes(service.used_traffic ?? 0)}
						hint={`${t("entityPages.lifetime", "Lifetime")} ${formatBytes(service.lifetime_used_traffic ?? 0)}`}
					/>
					<OverviewStat
						label={t("entityPages.status", "Status")}
						value={service.broken ? t("entityPages.broken", "Broken") : t("entityPages.healthy", "Healthy")}
					/>
				</>
			}
			main={
				<OverviewPanel
					title={t("entityPages.usageByAdmin", "Usage by admin")}
					description={t("entityPages.lastDays", "Last {{count}} days", { count: 30 })}
				>
					<OverviewRankedBars
						format={(value) => formatBytes(value, 1)}
						items={admins}
						empty={t("entityPages.noUsage", "No usage in this range")}
					/>
				</OverviewPanel>
			}
			aside={
				<OverviewPanel title={t("entityPages.details", "Details")}>
					<OverviewFacts
						items={[
							{
								label: t("entityPages.usageCoefficient", "Usage coefficient"),
								value: `×${service.usage_coefficient ?? 1}`,
							},
							{ label: t("entityPages.hosts", "Hosts"), value: service.host_count ?? 0 },
							{ label: t("entityPages.status", "Status"), value: <ServiceStatus service={service} /> },
						]}
					/>
					{service.description ? (
						<p className="pt-3 text-sm text-muted-foreground">{service.description}</p>
					) : null}
				</OverviewPanel>
			}
		/>
	);
};

type HostFacts = Partial<
	Record<
		| "remark"
		| "address"
		| "port"
		| "sni"
		| "host"
		| "path"
		| "security"
		| "alpn"
		| "fingerprint"
		| "mux_enable"
		| "is_disabled"
		| "allowinsecure"
		| "random_user_agent"
		| "use_sni_as_host"
		| "dns_primary"
		| "dns_secondary",
		unknown
	>
>;

const onOff = (value: unknown, t: (key: string, fallback: string) => string) =>
	value ? t("entityPages.on", "On") : t("entityPages.off", "Off");

const HostStatus = ({ host }: { host: HostFacts }) => {
	const { t } = useTranslation();
	return (
		<StatusBadge tone={host.is_disabled ? "muted" : "good"}>
			{host.is_disabled ? t("entityPages.disabled", "Disabled") : t("entityPages.enabled", "Enabled")}
		</StatusBadge>
	);
};

const HostOverview = ({ host, inboundTag }: { host: HostFacts; inboundTag: string }) => {
	const { t } = useTranslation();
	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat
						label={t("entityPages.status", "Status")}
						value={host.is_disabled ? t("entityPages.disabled", "Disabled") : t("entityPages.enabled", "Enabled")}
					/>
					<OverviewStat
						label={t("entityPages.port", "Port")}
						value={display(host.port)}
						hint={`${t("entityPages.inbound", "Inbound")} ${inboundTag}`}
					/>
					<OverviewStat label={t("entityPages.security", "Security")} value={display(host.security)} />
					<OverviewStat label={t("entityPages.mux", "Mux")} value={onOff(host.mux_enable, t)} />
				</>
			}
			main={
				<>
					<OverviewPanel
						title={t("entityPages.connection", "Connection")}
						description={t("entityPages.connectionHint", "What clients receive in their config")}
					>
						<OverviewFacts
							items={[
								{ label: t("entityPages.address", "Address"), value: display(host.address) },
								{ label: t("entityPages.sni", "SNI"), value: display(host.sni) },
								{ label: t("entityPages.hostHeader", "Host header"), value: display(host.host) },
								{ label: t("entityPages.path", "Path"), value: display(host.path) },
								{ label: t("entityPages.alpn", "ALPN"), value: display(host.alpn) },
								{ label: t("entityPages.fingerprint", "Fingerprint"), value: display(host.fingerprint) },
							]}
						/>
					</OverviewPanel>
					<OverviewPanel title={t("entityPages.options", "Options")}>
						<OverviewFacts
							items={[
								{ label: t("entityPages.useSniAsHost", "Use SNI as host"), value: onOff(host.use_sni_as_host, t) },
								{ label: t("entityPages.allowInsecure", "Allow insecure"), value: onOff(host.allowinsecure, t) },
								{ label: t("entityPages.randomUserAgent", "Random user agent"), value: onOff(host.random_user_agent, t) },
								{ label: t("entityPages.dnsPrimary", "DNS primary"), value: display(host.dns_primary) },
								{ label: t("entityPages.dnsSecondary", "DNS secondary"), value: display(host.dns_secondary) },
								{ label: t("entityPages.status", "Status"), value: <HostStatus host={host} /> },
							]}
						/>
					</OverviewPanel>
				</>
			}
		/>
	);
};

const InboundOverview = ({ inbound }: { inbound: RawInbound }) => {
	const { t } = useTranslation();
	const network = inbound.streamSettings?.network ?? "tcp";
	const security = inbound.streamSettings?.security ?? "none";
	const clients = (inbound.settings as { clients?: unknown[] } | undefined)?.clients;
	const clientCount = Array.isArray(clients) ? clients.length : 0;
	return (
		<OverviewLayout
			kpis={
				<>
					<OverviewStat label={t("entityPages.protocol", "Protocol")} value={inbound.protocol.toUpperCase()} />
					<OverviewStat label={t("entityPages.port", "Port")} value={display(inbound.port)} />
					<OverviewStat label={t("entityPages.network", "Network")} value={network} />
					<OverviewStat
						label={t("entityPages.security", "Security")}
						value={security}
						hint={`${clientCount} ${t("entityPages.clients", "clients")}`}
					/>
				</>
			}
			main={
				<>
					<OverviewPanel
						title={t("entityPages.configuration", "Configuration")}
						description={t("entityPages.configurationHint", "Values the Xray config uses for this inbound")}
					>
						<OverviewFacts
							items={[
								{ label: t("entityPages.tag", "Tag"), value: inbound.tag },
								{ label: t("entityPages.listen", "Listen address"), value: display((inbound as { listen?: string }).listen) },
								{ label: t("entityPages.protocol", "Protocol"), value: inbound.protocol },
								{ label: t("entityPages.port", "Port"), value: display(inbound.port) },
								{ label: t("entityPages.network", "Network"), value: network },
								{ label: t("entityPages.security", "Security"), value: security },
							]}
						/>
					</OverviewPanel>
					<OverviewPanel title={t("entityPages.sniffing", "Sniffing")}>
						<OverviewFacts
							items={[
								{
									label: t("entityPages.sniffing", "Sniffing"),
									value: inbound.sniffing?.enabled ? t("entityPages.on", "On") : t("entityPages.off", "Off"),
								},
								{
									label: t("entityPages.destOverride", "Destination override"),
									value: inbound.sniffing?.destOverride?.join(", ") || "–",
								},
							]}
						/>
					</OverviewPanel>
				</>
			}
		/>
	);
};

const withPage = (
	title: string,
	subtitle: string | undefined,
	status: EntityPageInfo["status"],
	overview: EntityPageInfo["overview"],
): EntityPageInfo => ({ title, subtitle, status, overview });

export const nodeEntityPage = (node: NodeType) =>
	withPage(
		node.name,
		`${node.address}:${node.port}`,
		<StatusBadge tone={nodeTone(node.status)}>{capitalize(node.status)}</StatusBadge>,
		<NodeOverview node={node} />,
	);

export const adminEntityPage = (admin: Admin) =>
	withPage(
		admin.username,
		capitalize(admin.role),
		<StatusBadge tone={admin.status === "active" ? "good" : "muted"}>{capitalize(admin.status)}</StatusBadge>,
		<AdminOverview admin={admin} />,
	);

export const userEntityPage = (user: User) =>
	withPage(
		user.username,
		user.service_name ?? undefined,
		<StatusBadge tone={userTone(user.status)}>{capitalize(user.status)}</StatusBadge>,
		<UserOverview user={user} />,
	);

export const serviceEntityPage = (service: ServiceFacts) =>
	withPage(
		service.name,
		`${service.user_count ?? 0} users · ${service.host_count ?? 0} hosts`,
		<ServiceStatus service={service} />,
		<ServiceOverview service={service} />,
	);

export const hostEntityPage = (host: HostFacts & { remark?: unknown }, inboundTag: string) =>
	withPage(
		display(host.remark),
		`${display(host.address)}:${display(host.port)}`,
		<HostStatus host={host} />,
		<HostOverview host={host} inboundTag={inboundTag} />,
	);

export const inboundEntityPage = (inbound: RawInbound) =>
	withPage(
		inbound.tag,
		`${inbound.protocol} · ${display(inbound.port)}`,
		undefined,
		<InboundOverview inbound={inbound} />,
	);
