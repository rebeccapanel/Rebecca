import { useColorMode } from "@chakra-ui/react";
import type { ApexOptions } from "apexcharts";
import { useMemo } from "react";
import ReactApexChart from "react-apexcharts";
import { formatBytes } from "utils/formatByte";

export type AreaPoint = {
	x: string;
	y: number;
};

type UsageAreaChartProps = {
	data: AreaPoint[];
	label?: string;
};

export const UsageAreaChart = ({
	data,
	label = "Usage",
}: UsageAreaChartProps) => {
	const { colorMode } = useColorMode();
	const categories = data.map((p) => p.x);
	const series = [{ name: label, data: data.map((p) => p.y) }];

	const options: ApexOptions = useMemo(() => {
		const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
		return {
			chart: {
				type: "area",
				toolbar: { show: false },
				zoom: { enabled: false },
			},
			dataLabels: { enabled: false },
			stroke: { curve: "smooth", width: 2 },
			fill: {
				type: "gradient",
				gradient: {
					shadeIntensity: 1,
					opacityFrom: 0.35,
					opacityTo: 0.05,
					stops: [0, 80, 100],
				},
			},
			grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
			xaxis: {
				categories,
				labels: { style: { colors: categories.map(() => axisColor) } },
				axisBorder: { show: false },
				axisTicks: { show: false },
			},
			yaxis: {
				labels: {
					formatter: (value: number) => formatBytes(Number(value) || 0, 1),
					style: { colors: [axisColor] },
				},
			},
			tooltip: {
				theme: colorMode === "dark" ? "dark" : "light",
				shared: true,
				fillSeriesColor: false,
				y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) },
			},
			colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
		};
	}, [categories, colorMode]);

	return (
		<ReactApexChart
			options={options}
			series={series}
			type="area"
			height={360}
		/>
	);
};

export default UsageAreaChart;
