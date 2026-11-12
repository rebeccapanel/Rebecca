import type { ColorMode } from "lib/color-mode";
import type { ApexOptions } from "apexcharts";
import {
	DateRangePicker,
	type DateRangeValue,
} from "components/common/DateRangePicker";
import type { FilterUsageType } from "contexts/DashboardContext";
import dayjs, { type ManipulateType } from "dayjs";
import { type FC, useMemo, useState } from "react";
import { generateDistinctColors } from "utils/color";
import { formatBytes } from "utils/formatByte";

export type UsageFilterProps = {
	onChange: (filter: string, query: FilterUsageType) => void;
	defaultValue: string;
};

const usagePresets = [
	{ key: "7h", label: "7h", amount: 7, unit: "hour" as const },
	{ key: "1d", label: "1d", amount: 1, unit: "day" as const },
	{ key: "3d", label: "3d", amount: 3, unit: "day" as const },
	{ key: "1w", label: "1w", amount: 1, unit: "week" as const },
	{ key: "1m", label: "1m", amount: 1, unit: "month" as const },
	{ key: "3m", label: "3m", amount: 3, unit: "month" as const },
];

const parseRangeKey = (value: string) => {
	const num = Number(value.substring(0, value.length - 1));
	const unitBySuffix = {
		h: "hour",
		d: "day",
		w: "week",
		m: "month",
		y: "year",
	} as const;
	const unit = unitBySuffix[value[value.length - 1] as keyof typeof unitBySuffix];
	return Number.isFinite(num) && unit ? { num, unit } : null;
};

const buildRangeFromKey = (value: string): DateRangeValue => {
	const parsed = parseRangeKey(value);
	const unit = parsed?.unit ?? "month";
	const amount = parsed?.num ?? 1;
	const alignUnit: ManipulateType = unit === "hour" ? "hour" : "day";
	const end = dayjs().utc().endOf(alignUnit);
	const start = end
		.subtract(amount, unit as ManipulateType)
		.add(1, alignUnit)
		.startOf(alignUnit);
	return {
		start: start.toDate(),
		end: end.toDate(),
		presetKey: value,
		key: value,
		unit: unit === "hour" ? "hour" : "day",
	};
};

const toFilterQuery = (value: DateRangeValue): FilterUsageType => ({
	start: dayjs(value.start).utc().format("YYYY-MM-DDTHH:mm:ss"),
	end: dayjs(value.end).utc().format("YYYY-MM-DDTHH:mm:ss"),
});

export const UsageFilter: FC<UsageFilterProps> = ({
	onChange,
	defaultValue,
	...props
}) => {
	const initialRange = useMemo(
		() => buildRangeFromKey(defaultValue || "1m"),
		[defaultValue],
	);
	const [range, setRange] = useState<DateRangeValue>(initialRange);

	return (
		<div {...props}>
			<DateRangePicker
				value={range}
				presets={usagePresets}
				defaultPreset={defaultValue || "1m"}
				onChange={(nextRange) => {
					setRange(nextRange);
					onChange(nextRange.key || nextRange.presetKey || "custom", toFilterQuery(nextRange));
				}}
			/>
		</div>
	);
};

export function createUsageConfig(
	colorMode: ColorMode,
	title: string,
	series: any = [],
	labels: any = [],
) {
	const total = formatBytes((series as [number]).reduce((t, c) => t + c, 0));
	return {
		series: series,
		options: {
			labels: labels,
			chart: {
				width: "100%",
				height: "100%",
				type: "donut",
				animations: {
					enabled: false,
				},
			},
			title: {
				text: `${title}${total}`,
				align: "center",
				style: {
					fontWeight: "500",
					color:
						colorMode === "dark" ? "var(--color-gray-300)" : undefined,
				},
			},
			legend: {
				position: "bottom",
				labels: {
					colors: colorMode === "dark" ? "#CBD5E0" : undefined,
					useSeriesColors: false,
				},
			},
			stroke: {
				width: 1,
				colors: undefined,
			},
			dataLabels: {
				// ApexCharts 8 types these callbacks loosely; the runtime shape is
				// unchanged, so the option object narrows them once here.
				formatter: (_val: unknown, opts: unknown) => {
					const { seriesIndex, w } = opts as {
						seriesIndex: number;
						w: { config: { series: number[] } };
					};
					return formatBytes(w.config.series[seriesIndex], 1);
				},
			},
			tooltip: {
				custom: (opts: unknown) => {
					const { series, seriesIndex, w } = opts as {
						// One entry per series; a single-series chart flattens it to numbers.
						series: Array<number | number[]>;
						seriesIndex: number;
						w: {
							globals: { colors: string[] };
							config: { labels: string[] };
						};
					};
					const current = series[seriesIndex];
					const value = typeof current === "number" ? current : 0;
					const readable = formatBytes(value, 1);
					const seriesList: any[] = Array.isArray(series)
						? series
						: Array.isArray((w as any)?.config?.series)
							? (w as any).config.series
							: [];
					const sum = seriesList.reduce((acc: number, curr: any) => {
						const val =
							typeof curr === "number"
								? curr
								: Array.isArray(curr)
									? Number(curr[0])
									: 0;
						return acc + (Number(val) || 0);
					}, 0);
					const total = Math.max(sum, 1);
					const percent = `${Math.round((value / total) * 1000) / 10}%`;
					return `
            <div style="
                    background-color: ${w.globals.colors[seriesIndex]};
                    padding-left:12px;
                    padding-right:12px;
                    padding-top:6px;
                    padding-bottom:6px;
                    font-size:0.725rem;
                  "
            >
              ${w.config.labels[seriesIndex]}: <b>${percent}, ${readable}</b>
            </div>
          `;
				},
			},
			colors: generateDistinctColors(series.length),
		} as ApexOptions,
	};
}
