import { Spinner } from "components/ui/spinner";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { useColorMode } from "lib/color-mode";

import { InfoIcon } from "components/common/InfoIcon";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ChartBox } from "components/common/ChartBox";
import {
	DateRangePicker,
	type DateRangeValue,
} from "components/common/DateRangePicker";
import {
	buildUsageAreaOptions,
	buildUsageDonutOptions,
} from "components/usage/usageChartOptions";
import { useAdminsStore } from "contexts/AdminsContext";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { type ChangeEvent, type FC, useEffect, useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { type Admin, AdminRole, AdminTrafficLimitMode } from "types/Admin";
import type {
	ServiceAdminUsage,
	ServiceAdminUsageResponse,
	ServiceListResponse,
	ServiceSummary,
} from "types/Service";
import { formatBytes } from "utils/formatByte";

dayjs.extend(utc);

interface DailyUsagePoint {
	date: string;
	used_traffic: number;
}

interface AdminUsageApiResponse {
	usages?: Array<{
		date?: string;
		used_traffic?: number;
	}>;
}

const formatTimeseriesLabel = (value: string) => {
	if (!value) return value;
	const hasTime = value.includes(" ");
	const normalized = hasTime ? value.replace(" ", "T") : value;
	const parsed = dayjs.utc(normalized);
	if (!parsed.isValid()) return value;
	return hasTime
		? parsed.local().format("MM-DD HH:mm")
		: parsed.format("YYYY-MM-DD");
};

const formatApiStart = (date: Date) =>
	`${dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`;
const formatApiEnd = (date: Date) =>
	`${dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss")}Z`;
const toUtcMillis = (value: string) => {
	if (!value) return 0;
	const hasTime = value.includes(" ");
	const normalized = hasTime ? value.replace(" ", "T") : `${value}T00:00`;
	return dayjs.utc(normalized).valueOf();
};

const AdminsUsage: FC = () => {
	const { t } = useTranslation();
	const { colorMode } = useColorMode();
	const pagedAdmins = useAdminsStore((state) => state.admins);

	const [admins, setAdmins] = useState<Admin[]>([]);
	const [serviceOptions, setServiceOptions] = useState<ServiceSummary[]>([]);
	const [selectedServiceId, setSelectedServiceId] = useState<number | null>(
		null,
	);
	const [serviceAdminUsage, setServiceAdminUsage] = useState<
		ServiceAdminUsage[]
	>([]);
	const [loadingServiceUsage, setLoadingServiceUsage] = useState(false);
	const presets = useMemo(
		() => [
			{ key: "7h", label: "7h", amount: 7, unit: "hour" as const },
			{ key: "1d", label: "1d", amount: 1, unit: "day" as const },
			{ key: "3d", label: "3d", amount: 3, unit: "day" as const },
			{ key: "1w", label: "1w", amount: 7, unit: "day" as const },
			{ key: "1m", label: "1m", amount: 30, unit: "day" as const },
			{ key: "3m", label: "3m", amount: 90, unit: "day" as const },
		],
		[],
	);

	const buildDefaultRange = (): DateRangeValue => {
		const end = dayjs().utc().endOf("day");
		const start = end.subtract(30, "day").startOf("day");
		return {
			start: start.toDate(),
			end: end.toDate(),
			presetKey: "1m",
			key: "1m",
		};
	};
	const [serviceUsageRange, setServiceUsageRange] =
		useState<DateRangeValue>(buildDefaultRange);
	const [adminUsageRange, setAdminUsageRange] =
		useState<DateRangeValue>(buildDefaultRange);
	const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null);
	const [points, setPoints] = useState<DailyUsagePoint[]>([]);
	const [loading, setLoading] = useState(false);
	const filteredAdmins = useMemo(() => {
		if (!selectedServiceId) return admins;
		const allowedUsernames = new Set(
			serviceAdminUsage
				.map((entry) => entry.username)
				.filter((username): username is string => Boolean(username)),
		);
		const filtered = admins.filter((admin) =>
			allowedUsernames.has(admin.username),
		);
		return filtered.length ? filtered : admins;
	}, [admins, selectedServiceId, serviceAdminUsage]);
	const selectedAdminRecord = useMemo(
		() =>
			filteredAdmins.find((admin) => admin.username === selectedAdmin) ??
			admins.find((admin) => admin.username === selectedAdmin) ??
			null,
		[admins, filteredAdmins, selectedAdmin],
	);
	const isCreatedTrafficBasis = Boolean(
		selectedAdminRecord &&
			selectedAdminRecord.role !== AdminRole.FullAccess &&
			selectedAdminRecord.traffic_limit_mode ===
				AdminTrafficLimitMode.CreatedTraffic,
	);
	const serviceUsageTotal = useMemo(
		() =>
			serviceAdminUsage.reduce(
				(acc, item) => acc + (item.used_traffic || 0),
				0,
			),
		[serviceAdminUsage],
	);
	const serviceDonutSeries = useMemo(
		() => serviceAdminUsage.map((item) => item.used_traffic || 0),
		[serviceAdminUsage],
	);
	const serviceDonutLabels = useMemo(
		() =>
			serviceAdminUsage.map(
				(item) => item.username || t("services.unassignedAdmin"),
			),
		[serviceAdminUsage, t],
	);
	const serviceDonutOptions = useMemo(
		() => buildUsageDonutOptions(colorMode, serviceDonutLabels),
		[colorMode, serviceDonutLabels],
	);

	useEffect(() => {
		let cancelled = false;

		const loadServices = async () => {
			try {
				const response = await apiFetch<ServiceListResponse>("/v2/services", {
					query: { limit: 500 },
				});
				if (cancelled || !response) return;
				const list = response.services ?? [];
				setServiceOptions(list);
				setSelectedServiceId((prev) => {
					if (prev !== null) return prev;
					return list.length ? list[0].id : null;
				});
			} catch (_error: unknown) {
				if (!cancelled) {
					setServiceOptions([]);
				}
			}
		};

		loadServices();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!selectedServiceId) {
			setServiceAdminUsage([]);
			return;
		}
		let cancelled = false;
		setLoadingServiceUsage(true);
		apiFetch<ServiceAdminUsageResponse>(
			`/v2/services/${selectedServiceId}/usage/admins`,
			{
				query: {
					start: formatApiStart(serviceUsageRange.start),
					end: formatApiEnd(serviceUsageRange.end),
				},
			},
		)
			.then((data: ServiceAdminUsageResponse | null) => {
				if (cancelled || !data) return;
				setServiceAdminUsage(data.admins ?? []);
			})
			.catch(() => {
				if (!cancelled) {
					setServiceAdminUsage([]);
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingServiceUsage(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedServiceId, serviceUsageRange.start, serviceUsageRange.end]);

	// load all admins (not paginated) for the select list
	useEffect(() => {
		let cancelled = false;
		const loadAll = async () => {
			try {
				const data = await apiFetch<Admin[] | { admins?: Admin[] }>(`/admins`);
				if (cancelled) return;
				if (Array.isArray(data)) setAdmins(data);
				else setAdmins(data.admins || []);
			} catch (err: unknown) {
				console.error("Failed to load all admins:", err);
				// fallback to paged admins from store
				setAdmins(pagedAdmins || []);
			}
		};
		loadAll();
		return () => {
			cancelled = true;
		};
	}, [pagedAdmins]);

	useEffect(() => {
		if (!selectedAdmin) return;
		let cancelled = false;
		setLoading(true);
		const isHourly = dayjs(adminUsageRange.start).isSame(
			adminUsageRange.end,
			"day",
		);
		const query: Record<string, string> = {
			start: formatApiStart(adminUsageRange.start),
			end: formatApiEnd(adminUsageRange.end),
		};
		if (isHourly) {
			query.granularity = "hour";
		}
		const endpoint = isHourly ? "chart" : "daily";
		console.debug("AdminsUsage: fetching usage", {
			selectedAdmin,
			endpoint,
			query,
		});
		apiFetch<AdminUsageApiResponse>(
			`/admin/${encodeURIComponent(selectedAdmin)}/usage/${endpoint}`,
			{ query },
		)
			.then((data: AdminUsageApiResponse | null) => {
				if (cancelled) return;
				const usages = Array.isArray(data?.usages) ? data.usages : [];
				console.debug("AdminsUsage: response usages", {
					length: usages.length,
					endpoint,
				});
				let mapped: DailyUsagePoint[];
				if (isHourly) {
					const aggregated = new Map<string, number>();
					usages.forEach((entry) => {
						const dateLabel = typeof entry?.date === "string" ? entry.date : "";
						if (!dateLabel) return;
						const current = aggregated.get(dateLabel) ?? 0;
						aggregated.set(
							dateLabel,
							current + Number(entry?.used_traffic ?? 0),
						);
					});
					const aggregatedEntries: Array<[string, number]> = Array.from(
						aggregated.entries(),
					);
					aggregatedEntries.sort(
						(entryA: [string, number], entryB: [string, number]) => {
							const [dateA] = entryA;
							const [dateB] = entryB;
							return toUtcMillis(dateA) - toUtcMillis(dateB);
						},
					);
					mapped = aggregatedEntries.map(([date, used]) => ({
						date,
						used_traffic: used,
					}));
				} else {
					const dailyPoints = usages.map(
						(entry): DailyUsagePoint => ({
							date: entry?.date ?? "",
							used_traffic: Number(entry?.used_traffic ?? 0),
						}),
					);
					dailyPoints.sort(
						(pointA: DailyUsagePoint, pointB: DailyUsagePoint) =>
							toUtcMillis(pointA.date) - toUtcMillis(pointB.date),
					);
					mapped = dailyPoints;
				}
				setPoints(mapped);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				console.error("Error fetching admin usage:", err);
				setPoints([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdmin, adminUsageRange]);

	useEffect(() => {
		if (!filteredAdmins || filteredAdmins.length === 0) return;
		const hasSelected = filteredAdmins.some(
			(admin) => admin.username === selectedAdmin,
		);
		if (!hasSelected) {
			setSelectedAdmin(filteredAdmins[0].username);
		}
	}, [filteredAdmins, selectedAdmin]);

	const categories = useMemo(
		() => points.map((p) => formatTimeseriesLabel(p.date)),
		[points],
	);
	const series = useMemo(
		() => [
			{
				name: isCreatedTrafficBasis
					? t("myaccount.createdTraffic")
					: t("nodes.usedTrafficSeries"),
				data: points.map((p) => p.used_traffic),
			},
		],
		[isCreatedTrafficBasis, points, t],
	);

	const chartConfig = useMemo(
		() => ({
			options: buildUsageAreaOptions(colorMode, categories),
			series,
		}),
		[colorMode, categories, series],
	);

	const total = useMemo(
		() => points.reduce((sum, p) => sum + Number(p.used_traffic || 0), 0),
		[points],
	);

	const dateRangePresets = useMemo(
		() =>
			presets.map((p) => ({
				key: p.key,
				label: p.label,
				amount: p.amount,
				unit: (p.unit === "hour" ? "hour" : "day") as
					| "hour"
					| "day"
					| "week"
					| "month",
			})),
		[presets],
	);

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<ChartBox
				title={t("admins.serviceUsageTitle")}
				headerActions={
					<div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
						<Select value={selectedServiceId ?? ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => {
								const value = Number(event.target.value);
								setSelectedServiceId(Number.isNaN(value) ? null : value);
							}} placeholder={t("admins.selectService")} disabled={!serviceOptions.length} className="sm:min-w-[220px]!">
							{serviceOptions.map((service) => (
								<option key={service.id} value={service.id}>
									{service.name}
								</option>
							))}
						</Select>
						<DateRangePicker
							value={serviceUsageRange}
							onChange={setServiceUsageRange}
							presets={dateRangePresets}
							defaultPreset="1m"
						/>
						<div className="flex flex-row items-center gap-2 text-[0.875rem] text-gray-500 dark:text-gray-400">
							<InfoIcon />
							<p>
								{t("usage.selectedRangeTotal")}:{" "}
								<span className="font-medium">
									{formatBytes(serviceUsageTotal, 2)}
								</span>
							</p>
						</div>
					</div>
				}
			>
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400 mb-4">
					{t("admins.serviceUsageHint")}
				</p>
				<div className="flex mt-6 flex-col lg:flex-row gap-4 lg:gap-6 items-stretch lg:items-center">
					<div className="flex-1">
						{loadingServiceUsage ? (
							<div className="flex flex-col items-center gap-3 py-8">
								<Spinner />
								<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
									{t("loading")}
								</p>
							</div>
						) : serviceAdminUsage.length && serviceUsageTotal > 0 ? (
							<ReactApexChart type="donut" height={320} options={serviceDonutOptions} series={serviceDonutSeries} />
						) : (
							<p className="text-center text-gray-500 dark:text-gray-400">
								{t("noData")}
							</p>
						)}
					</div>
					<div className="flex flex-col flex-1 items-stretch gap-2">
						{serviceAdminUsage.length ? (
							serviceAdminUsage.map((item) => {
								const username = item.username || t("services.unassignedAdmin");
								const isSelectable = Boolean(item.username);
								const isActive =
									selectedAdmin === item.username && isSelectable;
								return (
									<Button key={`${item.admin_id ?? "na"}-${username}`} onClick={() => {
											if (isSelectable && item.username) {
												setSelectedAdmin(item.username);
											}
										}} disabled={!isSelectable} size="sm" className="justify-between" variant={isActive ? "default" : "outline"}>
										<div className="flex flex-row items-center gap-2 justify-between w-full">
											<p>{username}</p>
											<p className="text-[0.875rem] text-gray-500 dark:text-gray-300">
												{formatBytes(item.used_traffic || 0, 2)}
											</p>
										</div>
									</Button>
								);
							})
						) : (
							<p className="text-gray-500 dark:text-gray-400">
								{t("noData")}
							</p>
						)}
					</div>
				</div>
			</ChartBox>
			<ChartBox
				title={
					<div className="flex flex-row gap-2 items-center">
						<p className="font-semibold">
							{isCreatedTrafficBasis
								? t("myaccount.dailyCreatedTraffic")
								: t("admins.dailyUsage")}
						</p>
						<Tooltip>
<TooltipTrigger asChild>
							<InfoIcon aria-label="info" className="text-gray-500 dark:text-gray-400 cursor-help" />
						</TooltipTrigger>
<TooltipContent>{
								isCreatedTrafficBasis
									? t("admins.dailyCreatedTrafficTooltip")
									: t("admins.dailyUsageTooltip")
							}</TooltipContent>
</Tooltip>
					</div>
				}
				headerActions={
					<div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center justify-end w-full">
						<DateRangePicker
							value={adminUsageRange}
							onChange={setAdminUsageRange}
							presets={dateRangePresets}
							defaultPreset="1m"
						/>
						<Select value={selectedAdmin ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) =>
								setSelectedAdmin(e.target.value || null)
							} disabled={!filteredAdmins.length} className="w-full sm:w-auto md:w-[220px] md:min-w-[200px]!">
							{filteredAdmins.map((a) => (
								<option key={a.username} value={a.username}>
									{a.username}
								</option>
							))}
						</Select>
					</div>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
						{t("admins.selectedAdmin")}:{" "}
						<span className="font-medium">
							{selectedAdmin ?? "-"}
						</span>{" "}
						{isCreatedTrafficBasis
							? t("myaccount.totalCreatedTraffic")
							: t("nodes.totalLabel")}
						:{" "}
						<span className="font-medium">
							{formatBytes(total || 0, 2)}
						</span>
					</p>
				</div>
				{loading ? (
					<div className="flex flex-col items-center gap-3">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
							{t("loading")}
						</p>
					</div>
				) : chartConfig.series[0]?.data?.length ? (
					<ReactApexChart options={chartConfig.options} series={chartConfig.series} type="area" height={360} />
				) : (
					<p className="text-center text-gray-500 dark:text-gray-400">
						{t("noData")}
					</p>
				)}
			</ChartBox>
		</div>
	);
};

export default AdminsUsage;
