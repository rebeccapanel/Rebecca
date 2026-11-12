import type { ApexOptions } from "apexcharts";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import ReactApexChart from "react-apexcharts";
import { Badge } from "components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "components/ui/card";
import { Progress } from "components/ui/progress";
import { Skeleton } from "components/ui/skeleton";
import { useColorMode } from "lib/color-mode";
import { cn } from "lib/cn";

export type EntityTone = "good" | "warn" | "bad" | "muted";

export type EntityPageInfo = {
	title: ReactNode;
	subtitle?: ReactNode;
	status?: ReactNode;
	overview: ReactNode;
};

const TONE_DOT: Record<EntityTone, string> = {
	good: "bg-emerald-500",
	warn: "bg-amber-500",
	bad: "bg-destructive",
	muted: "bg-muted-foreground",
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const readAccentColor = () => {
	if (typeof document === "undefined") return "#2563eb";
	return (
		getComputedStyle(document.documentElement)
			.getPropertyValue("--rb-panel-accent")
			.trim() || "#2563eb"
	);
};

export const usageRangeQuery = (days: number) => {
	const end = dayjs();
	const start = end.subtract(days, "day").startOf("day");
	const format = (value: dayjs.Dayjs) =>
		`${value.utc().format("YYYY-MM-DDTHH:mm:ss")}Z`;
	return { start: format(start), end: format(end) };
};

export const formatChartLabel = (value: string) => {
	const parsed = dayjs(value.replace(" ", "T"));
	return parsed.isValid() ? parsed.format("MMM D") : value;
};

export const StatusBadge = ({
	tone,
	children,
}: {
	tone: EntityTone;
	children: ReactNode;
}) => (
	<Badge variant="outline" className="h-6 gap-1.5 px-2.5 text-sm font-normal">
		<span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
		{children}
	</Badge>
);

export const OverviewStat = ({
	label,
	value,
	hint,
	meter,
}: {
	label: ReactNode;
	value: ReactNode;
	hint?: ReactNode;
	meter?: number | null;
}) => (
	<Card className="gap-3 py-4">
		<CardHeader className="gap-1 px-4">
			<CardDescription>{label}</CardDescription>
			<CardTitle className="truncate text-2xl font-semibold tabular-nums">
				{value}
			</CardTitle>
		</CardHeader>
		<CardContent className="flex flex-col gap-3 px-4">
			{meter === undefined || meter === null ? null : (
				<Progress
					value={clampPercent(meter)}
					className="h-1.5"
					indicatorClassName="bg-foreground/70"
				/>
			)}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</CardContent>
	</Card>
);

export const OverviewPanel = ({
	title,
	description,
	action,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) => (
	<Card className="min-w-0 gap-4 py-4">
		<CardHeader className="px-4">
			<CardTitle className="text-sm">{title}</CardTitle>
			{description ? <CardDescription>{description}</CardDescription> : null}
			{action ? <CardAction>{action}</CardAction> : null}
		</CardHeader>
		<CardContent className="px-4">{children}</CardContent>
	</Card>
);

export const OverviewFacts = ({
	items,
}: {
	items: Array<{ label: ReactNode; value: ReactNode }>;
}) => (
	<dl className="flex flex-col">
		{items.map((item) => (
			<div
				key={String(item.label)}
				className="flex items-start justify-between gap-4 border-b py-2.5 last:border-b-0"
			>
				<dt className="shrink-0 text-sm text-muted-foreground">{item.label}</dt>
				<dd className="min-w-0 break-all text-end text-sm tabular-nums">{item.value}</dd>
			</div>
		))}
	</dl>
);

export const OverviewRow = ({ children }: { children: ReactNode }) => (
	<div className="grid gap-4 xl:grid-cols-2 [&>:only-child]:xl:col-span-2">
		{children}
	</div>
);

export const OverviewLayout = ({
	kpis,
	main,
	aside,
}: {
	kpis?: ReactNode;
	main: ReactNode;
	aside?: ReactNode;
}) => (
	<div className="flex flex-col gap-4">
		{kpis ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis}</div> : null}
		<OverviewRow>{main}</OverviewRow>
		{aside ? <OverviewRow>{aside}</OverviewRow> : null}
	</div>
);

export const OverviewEmpty = ({ children }: { children: ReactNode }) => (
	<p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
);

export const OverviewChartSkeleton = () => (
	<Skeleton className="h-[240px] w-full rounded-lg" />
);

export const OverviewRankedBars = ({
	items,
	format,
	empty,
}: {
	items: Array<{ label: string; value: number }>;
	format: (value: number) => string;
	empty: ReactNode;
}) => {
	if (items.length === 0) {
		return <OverviewEmpty>{empty}</OverviewEmpty>;
	}
	const max = Math.max(1, ...items.map((item) => item.value));
	return (
		<ul className="flex flex-col gap-4">
			{items.map((item) => (
				<li key={item.label} className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3 text-sm">
						<span className="truncate">{item.label}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground">
							{format(item.value)}
						</span>
					</div>
					<Progress
						value={(item.value / max) * 100}
						className="h-1.5"
						indicatorClassName="bg-foreground/70"
					/>
				</li>
			))}
		</ul>
	);
};

export const OverviewChart = ({
	type,
	categories,
	series,
	formatter,
	height = 240,
}: {
	type: "line" | "area";
	categories: string[];
	series: Array<{ name: string; data: number[] }>;
	formatter: (value: number) => string;
	height?: number;
}) => {
	const { colorMode } = useColorMode();
	const dark = colorMode === "dark";
	const axis = dark ? "#a0aec0" : "#4a5568";
	const grid = dark ? "#2d3748" : "#e2e8f0";
	const accent = readAccentColor();
	const secondary = dark ? "#8b95a7" : "#6b7280";
	const options: ApexOptions = {
		chart: {
			type,
			toolbar: { show: false },
			zoom: { enabled: false },
			animations: { enabled: false },
			background: "transparent",
			fontFamily: "inherit",
		},
		colors: series.length > 1 ? [accent, secondary] : [accent],
		dataLabels: { enabled: false },
		stroke: { curve: "smooth", width: 2 },
		fill: { type: "solid", opacity: type === "area" ? 0.12 : 0 },
		markers: { size: 0, hover: { size: 4 } },
		grid: { borderColor: grid, strokeDashArray: 3 },
		xaxis: {
			categories,
			labels: {
				style: { colors: axis, fontSize: "11px" },
				hideOverlappingLabels: true,
			},
			axisBorder: { show: false },
			axisTicks: { show: false },
		},
		yaxis: {
			min: 0,
			labels: {
				formatter,
				style: { colors: [axis], fontSize: "11px" },
			},
		},
		legend: {
			show: series.length > 1,
			position: "top",
			horizontalAlign: "left",
			labels: { colors: axis },
		},
		tooltip: {
			theme: dark ? "dark" : "light",
			shared: true,
			y: { formatter },
		},
	};
	return (
		<ReactApexChart type={type} height={height} options={options} series={series} />
	);
};
