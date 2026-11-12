import { Spinner } from "components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useColorMode } from "lib/color-mode";

import {
	buildUsageAreaOptions,
	buildUsageDonutOptions,
} from "components/usage/usageChartOptions";
import { InfoIcon } from "components/common/InfoIcon";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ChartBox } from "components/common/ChartBox";
import {
	DateRangePicker,
	type DateRangeValue,
} from "components/common/DateRangePicker";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { type FC, useEffect, useMemo, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import type {
	ServiceAdminTimeseries,
	ServiceAdminUsage,
	ServiceAdminUsageResponse,
	ServiceSummary,
	ServiceUsagePoint,
	ServiceUsageTimeseries,
} from "types/Service";
import { formatBytes } from "utils/formatByte";
import {
	buildRangeFromPreset,
	dateRangeValueToUsageRange as dateRangeValueToRangeState,
	usageRangeToDateRangeValue as rangeStateToDateRangeValue,
	type UsageRange as RangeState,
	type UsageRangePreset as UsagePreset,
} from "utils/usageRange";

dayjs.extend(utc);

const presets: UsagePreset[] = [
	{ key: "24h", label: "24h", amount: 24, unit: "hour" },
	{ key: "7d", label: "7d", amount: 7, unit: "day" },
	{ key: "30d", label: "30d", amount: 30, unit: "day" },
	{ key: "90d", label: "90d", amount: 90, unit: "day" },
];

const formatApiStart = (date: Date) =>
	dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ssZ");
const formatApiEnd = (date: Date) =>
	dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ssZ");

const formatTimeseriesLabel = (
	timestamp: string,
	granularity: "day" | "hour",
) => {
	if (!timestamp) return timestamp;
	const parsed = dayjs.utc(timestamp);
	if (!parsed.isValid()) return timestamp;
	return granularity === "hour"
		? parsed.local().format("MM-DD HH:mm")
		: parsed.format("YYYY-MM-DD");
};

type ServiceUsageAnalyticsProps = {
	services: ServiceSummary[];
	selectedServiceId?: number | null;
};

// Helper function to convert RangeState to DateRangeValue
// Helper function to convert DateRangeValue to RangeState
export const ServiceUsageAnalytics: FC<ServiceUsageAnalyticsProps> = ({
	services,
	selectedServiceId,
}) => {
	const { t } = useTranslation();
	const { colorMode } = useColorMode();

	const serviceOptions = useMemo(
		() => services.map((service) => ({ id: service.id, name: service.name })),
		[services],
	);
	const initialServiceId = useMemo(() => {
		if (selectedServiceId) return selectedServiceId;
		if (serviceOptions.length) return serviceOptions[0].id;
		return null;
	}, [selectedServiceId, serviceOptions]);

	const defaultPreset =
		presets.find((preset) => preset.key === "30d") ?? presets[0];

	const [serviceId, setServiceId] = useState<number | null>(initialServiceId);
	const [serviceTimeseriesRange, setServiceTimeseriesRange] =
		useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
	const [adminTrendRange, setAdminTrendRange] = useState<RangeState>(() =>
		buildRangeFromPreset(defaultPreset),
	);
	const [adminDistributionRange, setAdminDistributionRange] =
		useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
	const [timeseries, setTimeseries] = useState<ServiceUsagePoint[]>([]);
	const [timeseriesGranularity, setTimeseriesGranularity] = useState<
		"day" | "hour"
	>("day");
	const [adminUsage, setAdminUsage] = useState<ServiceAdminUsage[]>([]);
	const [loadingTimeseries, setLoadingTimeseries] = useState(false);
	const [loadingAdmins, setLoadingAdmins] = useState(false);
	const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
	const [adminTimeseries, setAdminTimeseries] = useState<ServiceUsagePoint[]>(
		[],
	);
	const [adminTimeseriesGranularity, setAdminTimeseriesGranularity] = useState<
		"day" | "hour"
	>("day");
	const [adminTimeseriesUsername, setAdminTimeseriesUsername] =
		useState<string>("");
	const [loadingAdminTimeseries, setLoadingAdminTimeseries] = useState(false);

	useEffect(() => {
		setServiceId(initialServiceId);
	}, [initialServiceId]);

	useEffect(() => {
		if (!serviceId) {
			setTimeseries([]);
			setAdminUsage([]);
			setAdminTimeseries([]);
			setSelectedAdminId(null);
			setAdminTimeseriesUsername("");
			return;
		}
		const params = {
			start: formatApiStart(serviceTimeseriesRange.start),
			end: formatApiEnd(serviceTimeseriesRange.end),
		};
		const granularityParam =
			serviceTimeseriesRange.unit === "hour" ? "hour" : "day";

		let cancelled = false;
		setLoadingTimeseries(true);
		apiFetch<ServiceUsageTimeseries>(
			`/v2/services/${serviceId}/usage/timeseries`,
			{
				query: { ...params, granularity: granularityParam },
			},
		)
			.then((data) => {
				if (cancelled || !data) return;
				setTimeseries(data.points ?? []);
				setTimeseriesGranularity(data.granularity ?? granularityParam);
			})
			.catch(() => {
				if (!cancelled) {
					setTimeseries([]);
					setTimeseriesGranularity(granularityParam);
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingTimeseries(false);
			});

		return () => {
			cancelled = true;
		};
	}, [
		serviceId,
		serviceTimeseriesRange.start,
		serviceTimeseriesRange.end,
		serviceTimeseriesRange.unit,
	]);

	useEffect(() => {
		if (!serviceId) {
			setAdminUsage([]);
			setAdminTimeseries([]);
			setSelectedAdminId(null);
			setAdminTimeseriesUsername("");
			return;
		}
		const params = {
			start: formatApiStart(adminDistributionRange.start),
			end: formatApiEnd(adminDistributionRange.end),
		};

		let cancelled = false;
		setLoadingAdmins(true);
		apiFetch<ServiceAdminUsageResponse>(
			`/v2/services/${serviceId}/usage/admins`,
			{
				query: params,
			},
		)
			.then((data) => {
				if (cancelled || !data) return;
				setAdminUsage(data.admins ?? []);
			})
			.catch(() => {
				if (!cancelled) setAdminUsage([]);
			})
			.finally(() => {
				if (!cancelled) setLoadingAdmins(false);
			});

		return () => {
			cancelled = true;
		};
	}, [serviceId, adminDistributionRange.start, adminDistributionRange.end]);

	useEffect(() => {
		if (!serviceId) {
			setSelectedAdminId(null);
			setAdminTimeseries([]);
			setAdminTimeseriesUsername("");
			return;
		}

		if (!adminUsage.length) {
			setSelectedAdminId(null);
			return;
		}

		setSelectedAdminId((previous) => {
			const availableIds = adminUsage.map((item) => item.admin_id);
			if (previous === null) {
				if (availableIds.includes(null)) {
					return previous;
				}
			} else if (availableIds.includes(previous)) {
				return previous;
			}

			const withUsage = adminUsage.find((item) => (item.used_traffic || 0) > 0);
			if (withUsage) {
				return withUsage.admin_id ?? null;
			}

			const fallback = adminUsage[0];
			return fallback?.admin_id ?? null;
		});
	}, [adminUsage, serviceId]);

	useEffect(() => {
		if (!serviceId) {
			setAdminTimeseries([]);
			setAdminTimeseriesUsername("");
			setAdminTimeseriesGranularity("day");
			return;
		}

		if (selectedAdminId === undefined) {
			return;
		}

		if (!adminUsage.length && selectedAdminId === null) {
			setAdminTimeseries([]);
			setAdminTimeseriesUsername("");
			return;
		}

		const granularityParam = adminTrendRange.unit === "hour" ? "hour" : "day";
		const adminParam =
			selectedAdminId === null
				? "null"
				: Number.isFinite(selectedAdminId)
					? String(selectedAdminId)
					: "null";

		let cancelled = false;
		setLoadingAdminTimeseries(true);
		apiFetch<ServiceAdminTimeseries>(
			`/v2/services/${serviceId}/usage/admin-timeseries`,
			{
				query: {
					start: formatApiStart(adminTrendRange.start),
					end: formatApiEnd(adminTrendRange.end),
					granularity: granularityParam,
					admin_id: adminParam,
				},
			},
		)
			.then((data) => {
				if (cancelled || !data) return;
				setAdminTimeseries(data.points ?? []);
				setAdminTimeseriesGranularity(data.granularity ?? granularityParam);
				setAdminTimeseriesUsername(data.username ?? "");
			})
			.catch(() => {
				if (!cancelled) {
					setAdminTimeseries([]);
					setAdminTimeseriesUsername("");
					setAdminTimeseriesGranularity(granularityParam);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingAdminTimeseries(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [
		adminUsage,
		adminTrendRange.end,
		adminTrendRange.start,
		adminTrendRange.unit,
		selectedAdminId,
		serviceId,
	]);

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
		[],
	);

	const handleServiceTimeseriesRangeChange = (value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setServiceTimeseriesRange(rangeState);
	};

	const handleAdminTrendRangeChange = (value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setAdminTrendRange(rangeState);
	};

	const handleAdminDistributionRangeChange = (value: DateRangeValue) => {
		const rangeState = dateRangeValueToRangeState(value);
		setAdminDistributionRange(rangeState);
	};

	const categories = useMemo(
		() =>
			timeseries.map((point) =>
				formatTimeseriesLabel(point.timestamp, timeseriesGranularity),
			),
		[timeseries, timeseriesGranularity],
	);

	const areaSeries = useMemo(
		() => [
			{
				name: t("services.usageSeries"),
				data: timeseries.map((point) => point.used_traffic),
			},
		],
		[timeseries, t],
	);

	const areaOptions = useMemo(
		() =>
			buildUsageAreaOptions(colorMode, categories, {
				yTitle: t("services.usageYAxis"),
				xLabelRotate: 0,
			}),
		[categories, colorMode, t],
	);

	const adminSelectOptions = useMemo(
		() =>
			adminUsage.map((item) => ({
				value: item.admin_id === null ? "null" : String(item.admin_id),
				label: item.username || t("services.unassignedAdmin"),
			})),
		[adminUsage, t],
	);

	const adminDisplayLabel = useMemo(() => {
		const targetValue =
			selectedAdminId === null ? "null" : String(selectedAdminId);
		return (
			adminSelectOptions.find((option) => option.value === targetValue)
				?.label ??
			(selectedAdminId === null ? t("services.unassignedAdmin") : "")
		);
	}, [adminSelectOptions, selectedAdminId, t]);

	const adminTimeseriesCategories = useMemo(
		() =>
			adminTimeseries.map((point) =>
				formatTimeseriesLabel(point.timestamp, adminTimeseriesGranularity),
			),
		[adminTimeseries, adminTimeseriesGranularity],
	);

	const adminTimeseriesSeries = useMemo(
		() => [
			{
				name: t("services.usageSeries"),
				data: adminTimeseries.map((point) => point.used_traffic),
			},
		],
		[adminTimeseries, t],
	);

	const adminTimeseriesOptions = useMemo(
		() =>
			buildUsageAreaOptions(colorMode, adminTimeseriesCategories, {
				yTitle: t("services.usageYAxis"),
				xLabelRotate: 0,
			}),
		[adminTimeseriesCategories, colorMode, t],
	);

	const adminTimeseriesTotal = useMemo(
		() =>
			adminTimeseries.reduce(
				(total, point) => total + (point.used_traffic || 0),
				0,
			),
		[adminTimeseries],
	);

	const donutSeries = useMemo(
		() => adminUsage.map((item) => item.used_traffic),
		[adminUsage],
	);
	const donutLabels = useMemo(
		() =>
			adminUsage.map((item) => item.username || t("services.unassignedAdmin")),
		[adminUsage, t],
	);
	const donutOptions = useMemo(
		() => buildUsageDonutOptions(colorMode, donutLabels),
		[colorMode, donutLabels],
	);
	const adminTotal = useMemo(
		() => adminUsage.reduce((acc, item) => acc + (item.used_traffic || 0), 0),
		[adminUsage],
	);

	if (serviceOptions.length === 0) {
		return (
			<div className="flex flex-col gap-2 items-stretch mt-4">
				<p className="font-semibold">{t("services.usageAnalyticsTitle")}</p>
				<div className="border rounded-md p-6">
					<p className="text-gray-500">{t("services.noServicesAvailable")}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<div className="flex justify-between items-stretch md:items-center flex-col md:flex-row gap-3">
				<p className="font-semibold text-[1.125rem]">
					{t("services.usageAnalyticsTitle")}
				</p>
				<div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center">
					<Select value={serviceId ?? ""} onChange={(event) =>
							setServiceId(Number(event.target.value) || null)
						} className="md:min-w-[220px]!">
						{serviceOptions.map((service) => (
							<option key={service.id} value={service.id}>
								{service.name}
							</option>
						))}
					</Select>
				</div>
			</div>

			<ChartBox
				title={t("services.usageOverTime")}
				headerActions={
					<div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
						<div className="flex flex-row items-center gap-2 text-[0.875rem] text-gray-500">
							<InfoIcon />
							<p>
								{t("usage.selectedRangeTotal")}{" "}
								<span className="font-medium">
									{formatBytes(
										timeseries.reduce(
											(acc, item) => acc + (item.used_traffic || 0),
											0,
										),
										2,
									)}
								</span>
							</p>
						</div>
						<DateRangePicker
							value={rangeStateToDateRangeValue(serviceTimeseriesRange)}
							onChange={handleServiceTimeseriesRangeChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				{loadingTimeseries ? (
					<div className="flex flex-col items-center gap-3 py-10">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500">
							{t("loading")}
						</p>
					</div>
				) : timeseries.length ? (
					<ReactApexChart type="area" height={360} options={areaOptions} series={areaSeries} />
				) : (
					<p className="text-center text-gray-500">
						{t("noData")}
					</p>
				)}
			</ChartBox>

			<ChartBox
				title={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="flex flex-row gap-2 items-center">
							<p className="font-semibold">{t("services.adminUsageTrend")}</p>
							<InfoIcon aria-label="info" className="text-gray-500 cursor-help" />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("services.adminUsageTrendHint")}</TooltipContent>
</Tooltip>
				}
				headerActions={
					<div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
						<Select size="sm" value={
								selectedAdminId === null ? "null" : String(selectedAdminId)
							} onChange={(event) => {
								const value = event.target.value;
								if (value === "null") {
									setSelectedAdminId(null);
									return;
								}
								const parsed = Number(value);
								setSelectedAdminId(Number.isNaN(parsed) ? null : parsed);
							}} disabled={adminSelectOptions.length === 0} className="md:min-w-[200px]!">
							{adminSelectOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<DateRangePicker
							value={rangeStateToDateRangeValue(adminTrendRange)}
							onChange={handleAdminTrendRangeChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				<div className="flex flex-col items-start gap-1 mb-4">
					<p className="text-[0.875rem] text-gray-500">
						{t("admins.admin")}:{" "}
						<span className="font-medium">
							{adminDisplayLabel || adminTimeseriesUsername || "-"}
						</span>{" "}
						{t("usage.selectedRangeTotal")}:{" "}
						<span className="font-medium">
							{formatBytes(adminTimeseriesTotal || 0, 2)}
						</span>
					</p>
				</div>
				{loadingAdminTimeseries ? (
					<div className="flex flex-col items-center gap-3 py-10">
						<Spinner />
						<p className="text-[0.875rem] text-gray-500">
							{t("loading")}
						</p>
					</div>
				) : adminTimeseriesSeries[0]?.data?.length ? (
					<ReactApexChart type="area" height={360} options={adminTimeseriesOptions} series={adminTimeseriesSeries} />
				) : (
					<p className="text-center text-gray-500">
						{t("noData")}
					</p>
				)}
			</ChartBox>

			<ChartBox
				title={t("services.adminUsageDistribution")}
				headerActions={
					<div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
						<div className="flex flex-row items-center gap-2 text-[0.875rem] text-gray-500">
							<InfoIcon />
							<p>
								{t("usage.selectedRangeTotal")}{" "}
								<span className="font-medium">
									{formatBytes(adminTotal, 2)}
								</span>
							</p>
						</div>
						<DateRangePicker
							value={rangeStateToDateRangeValue(adminDistributionRange)}
							onChange={handleAdminDistributionRangeChange}
							presets={dateRangePresets}
							defaultPreset="30d"
						/>
					</div>
				}
			>
				<div className="flex flex-col lg:flex-row gap-6 items-stretch lg:items-center">
					<div className="flex-1">
						{loadingAdmins ? (
							<div className="flex flex-col items-center gap-3 py-8">
								<Spinner />
								<p className="text-[0.875rem] text-gray-500">
									{t("loading")}
								</p>
							</div>
						) : adminUsage.length && adminTotal > 0 ? (
							<ReactApexChart type="donut" height={320} options={donutOptions} series={donutSeries} />
						) : (
							<p className="text-center text-gray-500">
								{t("noData")}
							</p>
						)}
					</div>
					<div className="flex flex-col flex-1 items-stretch gap-2">
						{adminUsage.length ? (
							adminUsage.map((item) => (
								<div key={`${item.admin_id ?? "na"}-${item.username}`} className="flex flex-row items-center gap-2 justify-between border rounded-md px-3 py-2">
									<p className="font-medium">
										{item.username || t("services.unassignedAdmin")}
									</p>
									<p className="text-[0.875rem] text-gray-500">
										{formatBytes(item.used_traffic || 0, 2)}
									</p>
								</div>
							))
						) : (
							<p className="text-gray-500">{t("noData")}</p>
						)}
					</div>
				</div>
			</ChartBox>
		</div>
	);
};

export default ServiceUsageAnalytics;
