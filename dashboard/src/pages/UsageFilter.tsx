import { HStack, Select, useColorMode } from "@chakra-ui/react";
import type { ApexOptions } from "apexcharts";
import dayjs from "dayjs";
import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";

export type FilterUsageType = {
	start: string;
};

export const createUsageConfig = (
	colorMode: string,
	title: string,
	series: number[] = [],
	labels: string[] = [],
): { options: ApexOptions; series: number[] } => {
	const options: ApexOptions = {
		chart: {
			type: "donut",
		},
		title: {
			text: title,
			align: "center",
			style: {
				color: colorMode === "dark" ? "#d8dee9" : "#080808",
			},
		},
		labels,
		colors: ["#4CAF50", "#2196F3", "#FF9800", "#F44336", "#9C27B0"],
		dataLabels: {
			enabled: true,
			style: {
				colors: [colorMode === "dark" ? "#d8dee9" : "#080808"],
			},
		},
		legend: {
			position: "bottom",
			labels: {
				colors: colorMode === "dark" ? "#d8dee9" : "#080808",
			},
		},
	};

	return {
		options,
		series,
	};
};

export const UsageFilter: FC<{
	onChange: (filter: string, query: FilterUsageType) => void;
	defaultValue?: string;
}> = ({ onChange, defaultValue = "1m" }) => {
	const { t } = useTranslation();
	const [filter, setFilter] = useState(defaultValue);
	const { colorMode } = useColorMode();

	const handleFilterChange = (value: string) => {
		setFilter(value);
		const query: FilterUsageType = {
			start: getStartDate(value),
		};
		onChange(value, query);
	};

	const getStartDate = (filter: string): string => {
		switch (filter) {
			case "1d":
				return dayjs().utc().subtract(1, "day").format("YYYY-MM-DDTHH:00:00");
			case "1w":
				return dayjs().utc().subtract(1, "week").format("YYYY-MM-DDTHH:00:00");
			case "1m":
				return dayjs().utc().subtract(1, "month").format("YYYY-MM-DDTHH:00:00");
			case "3m":
				return dayjs().utc().subtract(3, "month").format("YYYY-MM-DDTHH:00:00");
			default:
				return dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00");
		}
	};

	return (
		<HStack>
			<Select
				size="sm"
				value={filter}
				onChange={(e) => handleFilterChange(e.target.value)}
				bg={colorMode === "dark" ? "gray.700" : "white"}
			>
				<option value="1d">{t("usageFilter.1d")}</option>
				<option value="1w">{t("usageFilter.1w")}</option>
				<option value="1m">{t("usageFilter.1m")}</option>
				<option value="3m">{t("usageFilter.3m")}</option>
			</Select>
		</HStack>
	);
};
