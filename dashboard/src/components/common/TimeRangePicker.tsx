import {
	Box,
	Button,
	ButtonGroup,
	HStack,
	Input,
	SimpleGrid,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	VStack,
} from "@chakra-ui/react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { type FC, useMemo, useState } from "react";

dayjs.extend(utc);

export type TimeRangeValue = {
	start: Date;
	end: Date;
	presetKey?: string;
};

type Preset = {
	key: string;
	label: string;
	amount: number;
	unit: "hour" | "day";
};

type TimeRangePickerProps = {
	presets: Preset[];
	value: TimeRangeValue;
	onChange: (next: TimeRangeValue) => void;
};

const RELATIVE_GROUPS = [
	{
		label: "Hours",
		options: [
			{ key: "1h", label: "1h", amount: 1 },
			{ key: "2h", label: "2h", amount: 2 },
			{ key: "3h", label: "3h", amount: 3 },
			{ key: "6h", label: "6h", amount: 6 },
			{ key: "8h", label: "8h", amount: 8 },
			{ key: "12h", label: "12h", amount: 12 },
		],
		unit: "hour" as const,
	},
	{
		label: "Days",
		options: [
			{ key: "1d", label: "1d", amount: 1 },
			{ key: "2d", label: "2d", amount: 2 },
			{ key: "3d", label: "3d", amount: 3 },
			{ key: "4d", label: "4d", amount: 4 },
			{ key: "5d", label: "5d", amount: 5 },
			{ key: "6d", label: "6d", amount: 6 },
		],
		unit: "day" as const,
	},
	{
		label: "Weeks",
		options: [
			{ key: "1w", label: "1w", amount: 7 },
			{ key: "2w", label: "2w", amount: 14 },
			{ key: "3w", label: "3w", amount: 21 },
			{ key: "4w", label: "4w", amount: 28 },
		],
		unit: "day" as const,
	},
	{
		label: "Months",
		options: [
			{ key: "1m", label: "1m", amount: 30 },
			{ key: "2m", label: "2m", amount: 60 },
			{ key: "3m", label: "3m", amount: 90 },
			{ key: "6m", label: "6m", amount: 180 },
			{ key: "8m", label: "8m", amount: 240 },
		],
		unit: "day" as const,
	},
];

const computeRange = (amount: number, unit: Preset["unit"]): TimeRangeValue => {
	const end = dayjs()
		.utc()
		.endOf(unit === "hour" ? "hour" : "day");
	const start = end
		.subtract(amount - 1, unit)
		.startOf(unit === "hour" ? "hour" : "day");
	return { start: start.toDate(), end: end.toDate() };
};

const toInput = (date: Date) => dayjs(date).format("YYYY-MM-DDTHH:mm");

const TimeRangePicker: FC<TimeRangePickerProps> = ({
	presets,
	value,
	onChange,
}) => {
	const [tabIndex, setTabIndex] = useState(0);

	const topPresets = useMemo(() => presets, [presets]);
	const activePreset = value.presetKey ?? topPresets[0]?.key ?? "custom";

	const applyRange = (range: TimeRangeValue, key?: string) => {
		onChange({ ...range, presetKey: key });
	};

	const handleTopPreset = (preset: Preset) => {
		applyRange(computeRange(preset.amount, preset.unit), preset.key);
		setTabIndex(0);
	};

	const handleRelative = (
		amount: number,
		unit: Preset["unit"],
		key: string,
	) => {
		applyRange(computeRange(amount, unit), key);
		setTabIndex(0);
	};

	const handleAbsolute = (field: "start" | "end", valueStr: string) => {
		if (!valueStr) return;
		const parsed = dayjs(valueStr);
		if (!parsed.isValid()) return;
		const nextRange =
			field === "start"
				? { start: parsed.toDate(), end: value.end }
				: { start: value.start, end: parsed.toDate() };
		applyRange(nextRange, "custom");
	};

	return (
		<VStack align="stretch" spacing={3}>
			<ButtonGroup size="sm" isAttached variant="outline" flexWrap="wrap">
				{topPresets.map((preset) => (
					<Button
						key={preset.key}
						onClick={() => handleTopPreset(preset)}
						variant={activePreset === preset.key ? "solid" : "outline"}
						colorScheme={activePreset === preset.key ? "primary" : undefined}
					>
						{preset.label}
					</Button>
				))}
				<Button
					onClick={() => {
						setTabIndex(1);
						applyRange(value, "custom");
					}}
					variant={activePreset === "custom" ? "solid" : "outline"}
					colorScheme={activePreset === "custom" ? "primary" : undefined}
				>
					Custom
				</Button>
			</ButtonGroup>

			<Box borderWidth="1px" borderRadius="md" overflow="hidden">
				<Tabs
					index={tabIndex}
					onChange={setTabIndex}
					isFitted
					variant="enclosed"
				>
					<TabList>
						<Tab>Relative</Tab>
						<Tab>Absolute</Tab>
					</TabList>
					<TabPanels>
						<TabPanel>
							<VStack align="stretch" spacing={4}>
								{RELATIVE_GROUPS.map((group) => (
									<Box key={group.label}>
										<Text fontSize="sm" mb={2} fontWeight="semibold">
											{group.label}
										</Text>
										<SimpleGrid columns={{ base: 3, sm: 6 }} spacing={2}>
											{group.options.map((opt) => (
												<Button
													key={opt.key}
													size="sm"
													variant={
														activePreset === opt.key ? "solid" : "outline"
													}
													colorScheme={
														activePreset === opt.key ? "primary" : undefined
													}
													onClick={() =>
														handleRelative(opt.amount, group.unit, opt.key)
													}
												>
													{opt.label}
												</Button>
											))}
										</SimpleGrid>
									</Box>
								))}
							</VStack>
						</TabPanel>
						<TabPanel>
							<VStack align="stretch" spacing={3}>
								<HStack>
									<Text fontSize="sm" minW="60px">
										Start
									</Text>
									<Input
										type="datetime-local"
										size="sm"
										value={toInput(value.start)}
										onChange={(e) => handleAbsolute("start", e.target.value)}
									/>
								</HStack>
								<HStack>
									<Text fontSize="sm" minW="60px">
										End
									</Text>
									<Input
										type="datetime-local"
										size="sm"
										value={toInput(value.end)}
										onChange={(e) => handleAbsolute("end", e.target.value)}
									/>
								</HStack>
							</VStack>
						</TabPanel>
					</TabPanels>
				</Tabs>
			</Box>
		</VStack>
	);
};

export default TimeRangePicker;
