import {
	Box,
	Button,
	chakra,
	HStack,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	SimpleGrid,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	type UseRadioProps,
	useBreakpointValue,
	useColorMode,
	useDisclosure,
	useOutsideClick,
	useRadio,
	useRadioGroup,
	VStack,
} from "@chakra-ui/react";
import { CalendarIcon } from "@heroicons/react/24/outline";
import DatePicker from "components/common/DatePicker";
import dayjs, { type ManipulateType } from "dayjs";
import { type FC, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const CalendarIconStyled = chakra(CalendarIcon, { baseStyle: { w: 4, h: 4 } });

type DateType = Date | null;

export type DateRangeValue = {
	start: Date;
	end: Date;
	presetKey?: string;
	key?: string;
	unit?: "hour" | "day" | "week" | "month";
};

export type DateRangePickerProps = {
	value: DateRangeValue;
	onChange: (value: DateRangeValue) => void;
	presets?: Array<{
		key: string;
		label: string;
		amount: number;
		unit: "hour" | "day" | "week" | "month";
	}>;
	defaultPreset?: string;
	showPresets?: boolean;
};

const FilterItem: FC<UseRadioProps & { border?: boolean } & any> = ({
	border,
	...props
}) => {
	const { getInputProps, getRadioProps } = useRadio(props);
	const fontSize = useBreakpointValue({ base: "xs", md: "sm" });
	return (
		<Box as="label">
			<input {...getInputProps()} />
			<Box
				{...getRadioProps()}
				minW="48px"
				w="full"
				h="full"
				textAlign="center"
				cursor="pointer"
				fontSize={fontSize}
				borderWidth={border ? "1px" : "0px"}
				borderRadius="md"
				_checked={{
					bg: "primary.500",
					color: "white",
					borderColor: "primary.500",
				}}
				_focus={{
					boxShadow: "outline",
				}}
				px={3}
				py={1}
			>
				{props.children}
			</Box>
		</Box>
	);
};

export const DateRangePicker: FC<DateRangePickerProps> = ({
	value,
	onChange,
	presets = [
		{ key: "24h", label: "24H", amount: 24, unit: "hour" },
		{ key: "7d", label: "7D", amount: 7, unit: "day" },
		{ key: "30d", label: "30D", amount: 30, unit: "day" },
		{ key: "90d", label: "90D", amount: 90, unit: "day" },
	],
	defaultPreset = "30d",
	showPresets = true,
}) => {
	const { t, i18n } = useTranslation();
	const { colorMode } = useColorMode();
	const { isOpen, onOpen, onClose } = useDisclosure();
	const customRef = useRef(null);
	useOutsideClick({ ref: customRef, handler: onClose });

	const _filterOptions = useBreakpointValue({
		base: ["7h", "1d", "3d", "1w"],
		md: ["7h", "1d", "3d", "1w", "1m", "3m"],
	})!;

	const filterOptionTypes = {
		h: "hour",
		d: "day",
		w: "week",
		m: "month",
		y: "year",
	};

	const customFilterOptions = useBreakpointValue({
		base: [
			{ title: "hours", options: ["1h", "3h", "6h", "12h"] },
			{ title: "days", options: ["1d", "2d", "3d", "4d"] },
			{ title: "weeks", options: ["1w", "2w", "3w", "4w"] },
			{ title: "months", options: ["1m", "2m", "3m", "6m"] },
		],
		md: [
			{ title: "hours", options: ["1h", "2h", "3h", "6h", "8h", "12h"] },
			{ title: "days", options: ["1d", "2d", "3d", "4d", "5d", "6d"] },
			{ title: "weeks", options: ["1w", "2w", "3w", "4w"] },
			{ title: "months", options: ["1m", "2m", "3m", "6m", "8m"] },
		],
	})!;

	const [tabIndex, setTabIndex] = useState(0);
	const [startDate, setStartDate] = useState<DateType>(value.start);
	const [endDate, setEndDate] = useState<DateType>(value.end);
	const [selectedPreset, setSelectedPreset] = useState<string>(
		value.presetKey || value.key || defaultPreset,
	);

	const monthsShown = useBreakpointValue({ base: 1, md: 2 });
	const fontSize = useBreakpointValue({ base: "xs", md: "sm" });

	useEffect(() => {
		setStartDate(value.start);
		setEndDate(value.end);
		setSelectedPreset(value.presetKey || value.key || defaultPreset);
	}, [value, defaultPreset]);

	const handlePresetChange = (presetKey: string) => {
		const preset = presets.find((p) => p.key === presetKey);
		if (!preset) return;

		const alignUnit: ManipulateType = preset.unit === "hour" ? "hour" : "day";
		const end = dayjs().utc().endOf(alignUnit).toDate();
		const span = Math.max(preset.amount - 1, 0);
		const start = dayjs()
			.utc()
			.subtract(span, preset.unit as ManipulateType)
			.startOf(alignUnit)
			.toDate();

		setSelectedPreset(presetKey);
		onChange({ start, end, presetKey, key: presetKey, unit: preset.unit });
		onClose();
	};

	const handleRelativeChange = (value: string) => {
		const num = Number(value.substring(0, value.length - 1));
		const unit =
			filterOptionTypes[
				value[value.length - 1] as keyof typeof filterOptionTypes
			];
		const alignUnit: ManipulateType = unit === "hour" ? "hour" : "day";
		const end = dayjs().utc().endOf(alignUnit).toDate();
		const span = Math.max(num - 1, 0);
		const start = dayjs()
			.utc()
			.subtract(span, unit as ManipulateType)
			.startOf(alignUnit)
			.toDate();

		onChange({
			start,
			end,
			presetKey: "custom",
			key: "custom",
			unit: unit as "hour" | "day",
		});
		onClose();
	};

	const handleAbsoluteChange = (dates: [DateType, DateType]) => {
		const [start, end] = dates;
		if (endDate && !end) {
			setStartDate(null);
			setEndDate(null);
		} else {
			setStartDate(start);
			setEndDate(end);
			if (start && end) {
				const startDate = dayjs(start);
				const endDate = dayjs(end);
				const [minDate, maxDate] = startDate.isBefore(endDate)
					? [startDate, endDate]
					: [endDate, startDate];
				const startAligned = minDate.startOf("day").toDate();
				const endAligned = maxDate.endOf("day").toDate();
				const isSingleDay = minDate.isSame(maxDate, "day");
				onChange({
					start: startAligned,
					end: endAligned,
					presetKey: "custom",
					key: "custom",
					unit: isSingleDay ? "hour" : "day",
				});
				onClose();
			}
		}
	};

	const { getRootProps, getRadioProps } = useRadioGroup({
		name: "relative-filter",
		defaultValue: "",
		onChange: handleRelativeChange,
	});

	const startLabel = dayjs(value.start).format("YYYY-MM-DD");
	const endLabel = dayjs(value.end).format("YYYY-MM-DD");
	const rangeLabel =
		startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;

	// Convert RangeState to DateRangeValue format
	const _dateRangeValue: DateRangeValue = {
		start: value.start,
		end: value.end,
		presetKey: value.presetKey || value.key,
		key: value.key || value.presetKey,
		unit: value.unit,
	};

	return (
		<HStack spacing={2} flexWrap="wrap">
			{showPresets &&
				presets.map((preset) => (
					<Button
						key={preset.key}
						size="sm"
						onClick={() => handlePresetChange(preset.key)}
						colorScheme="primary"
						variant={selectedPreset === preset.key ? "solid" : "outline"}
					>
						{preset.label}
					</Button>
				))}
			<Popover
				isOpen={isOpen}
				onClose={onClose}
				placement="auto-end"
				closeOnBlur={false}
				modifiers={[
					{ name: "preventOverflow", options: { padding: 16 } },
					{
						name: "flip",
						options: {
							fallbackPlacements: ["top-end", "bottom-start", "top-start"],
						},
					},
				]}
			>
				<PopoverTrigger>
					<Button
						size="sm"
						variant="outline"
						leftIcon={<CalendarIconStyled />}
						onClick={onOpen}
						minW={{ base: "200px", md: "240px" }}
						maxW="100%"
						overflow="hidden"
						textOverflow="ellipsis"
						whiteSpace="nowrap"
					>
						{rangeLabel}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					w="fit-content"
					maxW="calc(100vw - 2rem)"
					_focus={{ outline: "none" }}
				>
					<PopoverArrow />
					<PopoverBody px={0} py={0} ref={customRef}>
						<Tabs onChange={(index) => setTabIndex(index)} index={tabIndex}>
							<TabList px={3} pt={3}>
								<Tab fontSize={fontSize}>
									{t("userDialog.relative", "Relative")}
								</Tab>
								<Tab fontSize={fontSize}>
									{t("userDialog.absolute", "Absolute")}
								</Tab>
							</TabList>
							<TabPanels>
								<TabPanel px={3} pb={3}>
									<VStack spacing={3} align="stretch">
										{customFilterOptions.map((row) => (
											<VStack key={row.title} alignItems="start" spacing={2}>
												<Text
													fontSize={fontSize}
													fontWeight="medium"
													minW="60px"
												>
													{t(`userDialog.${row.title}`, row.title)}
												</Text>
												<SimpleGrid
													{...getRootProps()}
													columns={row.options.length}
													gap={2}
													w="full"
												>
													{row.options.map((option: string) => (
														<FilterItem
															key={option}
															border={true}
															{...getRadioProps({ value: option })}
														>
															{option}
														</FilterItem>
													))}
												</SimpleGrid>
											</VStack>
										))}
									</VStack>
								</TabPanel>
								<TabPanel px={3} pb={3} className="datepicker-panel">
									<VStack>
										<DatePicker
											locale={i18n.language.toLocaleLowerCase()}
											selected={startDate}
											onChange={handleAbsoluteChange}
											startDate={startDate}
											endDate={endDate}
											selectsRange={true}
											maxDate={new Date()}
											monthsShown={monthsShown}
											peekNextMonth={false}
											inline
										/>
									</VStack>
								</TabPanel>
							</TabPanels>
						</Tabs>
					</PopoverBody>
				</PopoverContent>
			</Popover>
		</HStack>
	);
};
