import {
	Box,
	Button,
	Flex,
	Grid,
	GridItem,
	HStack,
	IconButton,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	Text,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
} from "@chakra-ui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NumericInput } from "./common/NumericInput";

interface DateTimePickerProps {
	value?: Date | null;
	onChange: (date: Date | null) => void;
	placeholder?: string;
	disabled?: boolean;
	minDate?: Date;
	quickSelects?: Array<{
		label: string;
		onClick: () => void;
	}>;
}

export const DateTimePicker: FC<DateTimePickerProps> = ({
	value,
	onChange,
	placeholder,
	disabled = false,
	minDate,
	quickSelects = [],
}) => {
	const { t } = useTranslation();
	const inputPlaceholder = placeholder ?? t("dateTimePicker.selectDate");
	const { isOpen, onOpen, onClose } = useDisclosure();
	const isMobile = useBreakpointValue({ base: true, md: false }) ?? false;
	const [displayMonth, setDisplayMonth] = useState(() =>
		value ? dayjs(value) : dayjs(),
	);
	const [selectedTime, setSelectedTime] = useState({
		hour: value ? dayjs(value).hour() : 12,
		minute: value ? dayjs(value).minute() : 0,
	});
	const popoverBg = useColorModeValue("white", "gray.900");
	const popoverText = useColorModeValue("gray.900", "white");
	const popoverBorderColor = useColorModeValue("gray.200", "gray.700");
	const quickSelectBg = useColorModeValue("gray.50", "gray.800");
	const quickSelectBorderColor = useColorModeValue("gray.100", "gray.700");
	const quickSelectHoverBg = useColorModeValue("gray.100", "gray.700");
	const dayNameColor = useColorModeValue("gray.500", "gray.400");
	const disabledDayColor = useColorModeValue("gray.400", "gray.500");
	const dayHoverBg = useColorModeValue("gray.100", "gray.700");
	const timeDividerColor = useColorModeValue("gray.200", "gray.700");
	const timeLabelColor = useColorModeValue("gray.600", "gray.400");
	const todayBorderColor = useColorModeValue("primary.500", "primary.400");

	useEffect(() => {
		if (value) {
			setDisplayMonth(dayjs(value));
			setSelectedTime({
				hour: dayjs(value).hour(),
				minute: dayjs(value).minute(),
			});
		}
	}, [value]);

	// Reset calendar to today when popover closes
	const handleClose = () => {
		if (!value) {
			setDisplayMonth(dayjs());
			setSelectedTime({
				hour: 12,
				minute: 0,
			});
		}
		onClose();
	};

	const daysInMonth = displayMonth.daysInMonth();
	const firstDayOfMonth = displayMonth.startOf("month").day();
	const today = dayjs();
	const selectedDay = value ? dayjs(value) : null;

	const handleDateSelect = (day: number) => {
		const newDate = displayMonth
			.date(day)
			.hour(selectedTime.hour)
			.minute(selectedTime.minute)
			.second(0)
			.millisecond(0);

		if (minDate && newDate.isBefore(dayjs(minDate), "day")) {
			return;
		}

		onChange(newDate.toDate());
	};

	const handleTimeChange = (hour: number, minute: number) => {
		setSelectedTime({ hour, minute });
		if (value) {
			const newDate = dayjs(value).hour(hour).minute(minute);
			onChange(newDate.toDate());
		}
	};

	const handleClear = () => {
		onChange(null);
		setDisplayMonth(dayjs());
		setSelectedTime({
			hour: 12,
			minute: 0,
		});
		onClose();
	};

	const prevMonth = () => setDisplayMonth(displayMonth.subtract(1, "month"));
	const nextMonth = () => setDisplayMonth(displayMonth.add(1, "month"));

	const handleQuickSelect = (days: number) => {
		const baseDate = value ? dayjs(value) : dayjs();
		const newDate = baseDate.add(days, "day");
		onChange(newDate.toDate());
		// Don't close the popover so user can click multiple times
	};

	const builtInQuickSelects = [
		{ label: t("dateTimePicker.addDay"), onClick: () => handleQuickSelect(1) },
		{ label: t("dateTimePicker.addMonth"), onClick: () => handleQuickSelect(30) },
		{ label: t("dateTimePicker.addThreeMonths"), onClick: () => handleQuickSelect(90) },
		{ label: t("dateTimePicker.addSixMonths"), onClick: () => handleQuickSelect(180) },
		{ label: t("dateTimePicker.addYear"), onClick: () => handleQuickSelect(365) },
		{ label: t("dateTimePicker.addThreeYears"), onClick: () => handleQuickSelect(1095) },
	];

	const effectiveQuickSelects =
		quickSelects.length > 0 ? quickSelects : builtInQuickSelects;

	const renderDays = () => {
		const days = [];
		const minDay = minDate ? dayjs(minDate) : null;

		// Empty cells for days before month starts
		for (let i = 0; i < firstDayOfMonth; i++) {
			days.push(<GridItem key={`empty-${i}`} />);
		}

		// Days of the month
		for (let day = 1; day <= daysInMonth; day++) {
			const currentDate = displayMonth.date(day);
			const isToday = currentDate.isSame(today, "day");
			const isSelected = selectedDay?.isSame(currentDate, "day");
			const isPast = minDay && currentDate.isBefore(minDay, "day");

			days.push(
				<GridItem key={day}>
					<Button
						size="xs"
						variant="ghost"
						w="full"
						h={{ base: "34px", md: "28px" }}
						minW={{ base: "34px", md: "28px" }}
						fontSize="xs"
						fontWeight={isToday ? "bold" : "normal"}
						bg={isSelected ? "primary.500" : "transparent"}
						color={isSelected ? "white" : isPast ? disabledDayColor : "inherit"}
						border={isToday ? "1px solid" : "none"}
						borderColor={todayBorderColor}
						_hover={{
							bg: isPast
								? "transparent"
								: isSelected
									? "primary.600"
									: dayHoverBg,
						}}
						onClick={() => !isPast && handleDateSelect(day)}
						isDisabled={!!isPast}
						cursor={isPast ? "not-allowed" : "pointer"}
					>
						{day}
					</Button>
				</GridItem>,
			);
		}

		return days;
	};

	const displayValue = value ? dayjs(value).format("YYYY/MM/DD HH:mm") : "";
	const mobileTrigger = (
		<Button
			type="button"
			variant="outline"
			size="sm"
			w="full"
			h="32px"
			justifyContent="flex-start"
			fontWeight="normal"
			px={3}
			isDisabled={disabled}
			onClick={onOpen}
			bg="transparent"
			_dark={{ bg: "transparent" }}
		>
			<Text
				as="span"
				noOfLines={1}
				color={displayValue ? "inherit" : "gray.500"}
			>
				{displayValue || inputPlaceholder}
			</Text>
		</Button>
	);

	const pickerContent = (
		<Flex direction={{ base: "column", md: "row" }}>
			{/* Quick Select Sidebar */}
			<Flex
				gap={1}
				align="stretch"
				px={2}
				py={2}
				bg={quickSelectBg}
				minW={{ base: "0", md: "100px" }}
				maxW={{ base: "100%", md: "110px" }}
				borderRight={{ base: "0", md: "1px solid" }}
				borderBottom={{ base: "1px solid", md: "0" }}
				borderColor={quickSelectBorderColor}
				flexShrink={0}
				flexDirection={{ base: "row", md: "column" }}
				flexWrap={{ base: "wrap", md: "nowrap" }}
			>
				{effectiveQuickSelects.map((option) => (
					<Button
						key={option.label}
						variant="ghost"
						justifyContent={{ base: "center", md: "flex-start" }}
						size="sm"
						fontSize="xs"
						whiteSpace="nowrap"
						flex={{ base: "1 1 calc(33.333% - 4px)", md: "0 0 auto" }}
						minW={{ base: "82px", md: "auto" }}
						onClick={option.onClick}
						_hover={{ bg: quickSelectHoverBg }}
					>
						{option.label}
					</Button>
				))}
			</Flex>

			{/* Calendar */}
			<Box flex="1" p={{ base: 2, md: 2 }} minW={0}>
				{/* Month Navigation */}
				<Flex justify="space-between" align="center" mb={2}>
					<HStack spacing={1}>
						<IconButton
							aria-label={t("dateTimePicker.previousMonth")}
							size="xs"
							variant="ghost"
							icon={<ChevronLeftIcon width={14} height={14} />}
							onClick={prevMonth}
							_hover={{ bg: quickSelectHoverBg }}
						/>
						<IconButton
							aria-label={t("dateTimePicker.nextMonth")}
							size="xs"
							variant="ghost"
							icon={<ChevronRightIcon width={14} height={14} />}
							onClick={nextMonth}
							_hover={{ bg: quickSelectHoverBg }}
						/>
					</HStack>
					<Text fontSize="xs" fontWeight="semibold">
						{displayMonth.format("MMMM YYYY")}
					</Text>
				</Flex>

				{/* Day Names */}
				<Grid templateColumns="repeat(7, 1fr)" gap={0.5} mb={1}>
					{Array.from({ length: 7 }, (_, index) =>
						displayMonth.startOf("week").add(index, "day").format("dd"),
					).map((day) => (
						<GridItem key={day}>
							<Text
								fontSize="2xs"
								textAlign="center"
								color={dayNameColor}
								fontWeight="semibold"
							>
								{day}
							</Text>
						</GridItem>
					))}
				</Grid>

				{/* Days Grid */}
				<Grid templateColumns="repeat(7, 1fr)" gap={0.5} mb={2}>
					{renderDays()}
				</Grid>

				{/* Time Picker */}
				<HStack
					spacing={2}
					justify="center"
					pt={2}
					borderTop="1px solid"
					borderColor={timeDividerColor}
				>
					<Text fontSize="2xs" color={timeLabelColor}>
						{t("dateTimePicker.time")}
					</Text>
					<NumericInput
						size="xs"
						w="45px"
						min={0}
						max={23}
						value={selectedTime.hour}
						onChange={(value) => {
							const h = Math.max(0, Math.min(23, parseInt(value, 10) || 0));
							handleTimeChange(h, selectedTime.minute);
						}}
						fieldProps={{ textAlign: "center", fontSize: "xs" }}
					/>
					<Text fontSize="xs">:</Text>
					<NumericInput
						size="xs"
						w="45px"
						min={0}
						max={59}
						value={selectedTime.minute}
						onChange={(value) => {
							const m = Math.max(0, Math.min(59, parseInt(value, 10) || 0));
							handleTimeChange(selectedTime.hour, m);
						}}
						fieldProps={{ textAlign: "center", fontSize: "xs" }}
					/>
				</HStack>

				{/* Actions */}
				<HStack spacing={2} justify="flex-end" mt={2}>
					<Button size="xs" variant="ghost" onClick={handleClear}>
						{t("clear")}
					</Button>
					<Button size="xs" colorScheme="primary" onClick={handleClose}>
						{t("dateTimePicker.done")}
					</Button>
				</HStack>
			</Box>
		</Flex>
	);

	if (isMobile) {
		return (
			<>
				{mobileTrigger}
				<Modal
					isOpen={isOpen}
					onClose={handleClose}
					size="full"
					motionPreset="slideInBottom"
				>
					<ModalOverlay />
					<ModalContent
						m={0}
						minH="100dvh"
						bg={popoverBg}
						color={popoverText}
						borderRadius={0}
					>
						<ModalHeader fontSize="sm" py={3} pe={12}>
							{inputPlaceholder}
						</ModalHeader>
						<ModalCloseButton />
						<ModalBody p={0} overflowY="auto">
							{pickerContent}
						</ModalBody>
					</ModalContent>
				</Modal>
			</>
		);
	}

	return (
		<Popover
			isOpen={isOpen}
			onOpen={onOpen}
			onClose={handleClose}
			placement={isMobile ? "bottom" : "bottom-start"}
			isLazy
			strategy="fixed"
			modifiers={[
				{ name: "preventOverflow", options: { padding: 8 } },
				{
					name: "flip",
					options: {
						fallbackPlacements: ["top", "bottom-start", "top-start"],
					},
				},
			]}
		>
			<PopoverTrigger>
				<Input
					value={displayValue}
					placeholder={inputPlaceholder}
					size="sm"
					isReadOnly
					cursor="pointer"
					isDisabled={disabled}
					onClick={onOpen}
					bg="transparent"
					_dark={{ bg: "transparent" }}
				/>
			</PopoverTrigger>
			<Portal appendToParentPortal={false}>
				<PopoverContent
					className="date-time-picker-popover"
					w={{
						base: "calc(100vw - 16px)",
						sm: "min(420px, calc(100vw - 16px))",
						md: "auto",
					}}
					maxW="calc(100vw - 16px)"
					maxH={{ base: "min(82svh, 640px)", md: "calc(100vh - 24px)" }}
					overflow="hidden"
					bg={popoverBg}
					borderColor={popoverBorderColor}
					color={popoverText}
					zIndex={17020}
					_focus={{ boxShadow: "none" }}
				>
					<PopoverBody p={0} maxH="inherit" overflowY="auto">
						{pickerContent}
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);
};
