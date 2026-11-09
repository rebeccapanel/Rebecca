import {
	Badge,
	Box,
	Button,
	chakra,
	Flex,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuList,
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	SimpleGrid,
	Stack,
	Text,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	type PlacementWithLogical,
} from "@chakra-ui/react";
import {
	CalendarIcon as HeroCalendarIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { useSeasonal } from "contexts/SeasonalContext";
import { AnimatePresence, motion } from "framer-motion";
import {
	type FC,
	memo,
	useEffect,
	useMemo,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";

const CalendarIcon = chakra(HeroCalendarIcon, { baseStyle: { w: 4, h: 4 } });
const Sparkles = chakra(SparklesIcon, { baseStyle: { w: 3.5, h: 3.5 } });
const ChevronLeft = chakra(ChevronLeftIcon, { baseStyle: { w: 3, h: 3 } });
const ChevronRight = chakra(ChevronRightIcon, { baseStyle: { w: 3, h: 3 } });

const createStableKey = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
};

type CalendarDay = {
	date: Date;
	label: string;
	isToday: boolean;
	weekdayIndex: number;
};

const buildDoranMonthDays = (
	baseDate: Date,
	displayLocale: string,
	numberLocale: string,
	usePersian: boolean,
) => {
	const numericLocale = usePersian ? "en-u-ca-persian" : "en-u-ca-gregory";
	const monthFormatter = new Intl.DateTimeFormat(numericLocale, {
		month: "numeric",
	});
	const dayFormatter = new Intl.DateTimeFormat(numericLocale, {
		day: "numeric",
	});
	const monthId = monthFormatter.format(baseDate);
	const monthLabel = new Intl.DateTimeFormat(displayLocale, {
		month: "long",
		year: "numeric",
	}).format(baseDate);
	const currentDayNumber = Number(dayFormatter.format(baseDate));
	const firstDay = new Date(baseDate);
	firstDay.setDate(firstDay.getDate() - (currentDayNumber - 1));
	const numberFormatter = new Intl.NumberFormat(numberLocale);

	const days: CalendarDay[] = [];
	let cursor = firstDay;
	while (monthFormatter.format(cursor) === monthId) {
		const label = numberFormatter.format(Number(dayFormatter.format(cursor)));
		const weekday = cursor.getDay();
		const weekdayIndex = usePersian ? (weekday + 1) % 7 : weekday;

		days.push({
			date: new Date(cursor),
			label,
			isToday: cursor.toDateString() === new Date().toDateString(),
			weekdayIndex,
		});

		cursor = new Date(cursor);
		cursor.setDate(cursor.getDate() + 1);
	}

	return { monthLabel, days };
};

const DORAN_PERSIAN_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const DORAN_GREGORIAN_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface HeaderCalendarProps {
	isCompact?: boolean;
	inMenu?: boolean;
	placement?: PlacementWithLogical;
	isOpen?: boolean;
	isPressing?: boolean;
	onToggle?: () => void;
	onClose?: () => void;
}

export const HeaderCalendar: FC<HeaderCalendarProps> = memo(({
	isCompact = false,
	inMenu = false,
	placement,
	isOpen: controlledIsOpen,
	isPressing = false,
	onToggle: controlledOnToggle,
	onClose: controlledOnClose,
}) => {
	const { t, i18n } = useTranslation();
	const [today, setToday] = useState(() => new Date());
	const [displayDate, setDisplayDate] = useState(() => new Date());
	const [monthDirection, setMonthDirection] = useState<1 | -1>(1);
	const { isChristmas, window: seasonWindow } = useSeasonal();
	const isPersian = i18n.language?.startsWith("fa");
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const isDesktop = useBreakpointValue({ base: false, md: true }) ?? false;
	const showText = isDesktop && !isCompact;
	const isCircle = !isDesktop;
	const displayLocale = isPersian
		? "fa-IR-u-ca-persian"
		: `${i18n.language || "en"}-u-ca-gregory`;
	const numberLocale = isPersian ? "fa-IR" : i18n.language || "en";

	const cardBg = useColorModeValue("panel.surface", "panel.surface");
	const cardBorder = useColorModeValue("panel.border", "panel.border");
	const headerBtnBg = useColorModeValue("panel.surface", "panel.surface");
	const headerBtnBorder = useColorModeValue("panel.border", "panel.border");
	const textMuted = useColorModeValue("gray.500", "panel.textMuted");

	const { isOpen, onOpen, onClose } = useDisclosure();
	const isControlled = controlledIsOpen !== undefined;
	const isMenuOpen = isControlled ? controlledIsOpen : isOpen;

	const handleToggle = () => {
		if (controlledOnToggle) {
			controlledOnToggle();
		} else {
			isMenuOpen ? onClose() : onOpen();
		}
	};

	const handleMenuClose = () => {
		if (controlledOnClose) {
			controlledOnClose();
		} else {
			onClose();
		}
	};

	const popperModifiers = useMemo(
		() => [
			{
				name: "preventOverflow",
				options: {
					padding: 12,
					boundary: "clippingParents",
				},
			},
			{
				name: "flip",
				options: {
					fallbackPlacements: ["bottom-start", "left-start", "right-start"],
				},
			},
		],
		[],
	);

	useEffect(() => {
		const timer = setInterval(() => setToday(new Date()), 60 * 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		setDisplayDate(new Date());
	}, []);

	const formattedDate = useMemo(() => {
		const formatter = new Intl.DateTimeFormat(displayLocale, {
			weekday: "long",
			day: "numeric",
			month: "long",
			year: "numeric",
		});
		if (isPersian) {
			const parts = formatter.formatToParts(today);
			const getPart = (type: string) =>
				parts.find((p) => p.type === type)?.value || "";
			return `${getPart("weekday")}، ${getPart("day")} ${getPart("month")} ${getPart("year")}`;
		}
		return formatter.format(today);
	}, [displayLocale, today, isPersian]);

	const { monthLabel, days } = useMemo(
		() =>
			buildDoranMonthDays(
				displayDate,
				displayLocale,
				numberLocale,
				Boolean(isPersian),
			),
		[displayDate, displayLocale, isPersian, numberLocale],
	);

	const weekdayLabels = isPersian
		? DORAN_PERSIAN_WEEKDAYS
		: DORAN_GREGORIAN_WEEKDAYS;

	const emptySlots = days.length ? days[0].weekdayIndex : 0;
	const emptySlotKeys = useMemo(
		() => Array.from({ length: emptySlots }, () => createStableKey()),
		[emptySlots],
	);

	const holidayWeekdayIndex = isPersian ? 6 : 0;
	const prevIcon = isRTL ? <ChevronRight /> : <ChevronLeft />;
	const nextIcon = isRTL ? <ChevronLeft /> : <ChevronRight />;
	const popoverHighlight = useColorModeValue(
		"0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
		"inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
	);

	const isCurrentMonth = useMemo(() => {
		return (
			displayDate.getFullYear() === today.getFullYear() &&
			displayDate.getMonth() === today.getMonth()
		);
	}, [displayDate, today]);

	const handlePrevMonth = () => {
		setMonthDirection(isRTL ? 1 : -1);
		const next = new Date(displayDate);
		next.setMonth(displayDate.getMonth() - 1);
		setDisplayDate(next);
	};

	const handleNextMonth = () => {
		setMonthDirection(isRTL ? -1 : 1);
		const next = new Date(displayDate);
		next.setMonth(displayDate.getMonth() + 1);
		setDisplayDate(next);
	};

	const handleResetToday = () => {
		setMonthDirection(1);
		setDisplayDate(new Date());
	};

	const christmasRange = useMemo(() => {
		if (!seasonWindow) return null;
		const locale = i18n.language || "en";
		const formatter = new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
		});
		return `${formatter.format(seasonWindow.start)} - ${formatter.format(seasonWindow.end)}`;
	}, [i18n.language, seasonWindow]);

	useEffect(() => {
		if (inMenu || !isOpen) return;
		const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			const trigger = document.querySelector(
				'[data-header-calendar-trigger="true"]',
			);
			if (trigger?.contains(target)) return;
			const content = document.querySelector(
				'[data-header-calendar-content="true"]',
			);
			if (content?.contains(target)) return;
			onClose();
		};
		document.addEventListener("mousedown", handleDocumentPointerDown);
		document.addEventListener("touchstart", handleDocumentPointerDown, {
			passive: true,
		});
		return () => {
			document.removeEventListener("mousedown", handleDocumentPointerDown);
			document.removeEventListener("touchstart", handleDocumentPointerDown);
		};
	}, [inMenu, isOpen, onClose]);

	const renderCalendarBody = () => (
		<Stack spacing={3}>
			<Flex
				justify="space-between"
				align="center"
				dir={isRTL ? "rtl" : "ltr"}
				px={1}
			>
				<HStack spacing={1.5}>
					<IconButton
						size="xs"
						variant="outline"
						h="22px"
						w="22px"
						minW="22px"
						px={0}
						borderRadius="6px"
						borderColor={headerBtnBorder}
						bg={headerBtnBg}
						color="panel.textSecondary"
						aria-label={t("dateTimePicker.previousMonth")}
						icon={prevIcon}
						onClick={handlePrevMonth}
						_hover={{
							md: {
								bg: "panel.elevated",
								borderColor: "panel.borderStrong",
								color: "panel.text",
							},
						}}
						_active={{ transform: "scale(0.92)" }}
						transition="all 0.16s cubic-bezier(0.16, 1, 0.3, 1)"
					/>
					<IconButton
						size="xs"
						variant="outline"
						h="22px"
						w="22px"
						minW="22px"
						px={0}
						borderRadius="6px"
						borderColor={headerBtnBorder}
						bg={headerBtnBg}
						color="panel.textSecondary"
						aria-label={t("dateTimePicker.nextMonth")}
						icon={nextIcon}
						onClick={handleNextMonth}
						_hover={{
							md: {
								bg: "panel.elevated",
								borderColor: "panel.borderStrong",
								color: "panel.text",
							},
						}}
						_active={{ transform: "scale(0.92)" }}
						transition="all 0.16s cubic-bezier(0.16, 1, 0.3, 1)"
					/>
				</HStack>

				<HStack spacing={2} align="center">
					<Text fontWeight="700" fontSize="13px" color="panel.text">
						{monthLabel}
					</Text>
					{isChristmas && (
						<Badge
							colorScheme="red"
							display="inline-flex"
							alignItems="center"
							gap={1}
							borderRadius="full"
							px={2}
							py={0.5}
							fontSize="10px"
						>
							<Sparkles />
							{t("season.christmas")}
						</Badge>
					)}
				</HStack>

				<Button
					size="xs"
					variant={isCurrentMonth ? "ghost" : "outline"}
					colorScheme={isCurrentMonth ? undefined : "primary"}
					borderRadius="6px"
					fontSize="10px"
					fontWeight="600"
					px={2}
					h="22px"
					minW="auto"
					onClick={handleResetToday}
					opacity={isCurrentMonth ? 0.75 : 1}
					borderColor={
						isCurrentMonth ? "transparent" : "panel.borderStrong"
					}
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
					_hover={{
						md: {
							bg: "panel.elevated",
							borderColor: "panel.borderStrong",
						},
					}}
					_active={{ transform: "scale(0.94)" }}
				>
					{t("calendar.today")}
				</Button>
			</Flex>

			<SimpleGrid columns={7} spacing={1} px={1}>
				{weekdayLabels.map((label, idx) => {
					const isHol = idx === holidayWeekdayIndex;
					return (
						<Text
							key={label}
							textAlign="center"
							fontSize="11px"
							color={isHol ? "red.400" : textMuted}
							fontWeight="700"
							py={0.5}
						>
							{label}
						</Text>
					);
				})}
			</SimpleGrid>

			<Box overflow="hidden" position="relative" minH="210px">
				<AnimatePresence
					initial={false}
					custom={monthDirection}
					mode="wait"
				>
					<motion.div
						key={monthLabel}
						initial={{ opacity: 0, x: monthDirection * 20 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -monthDirection * 20 }}
						transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
					>
						<SimpleGrid columns={7} spacing={1} px={1}>
							{emptySlotKeys.map((key) => (
								<Box key={key} w="34px" h="34px" />
							))}
							{days.map((day) => {
								const isHoliday =
									day.weekdayIndex === holidayWeekdayIndex;
								return (
									<Flex
										key={day.date.toISOString()}
										w="34px"
										h="34px"
										align="center"
										justify="center"
										borderRadius="8px"
										bg={
											day.isToday
												? "var(--rb-panel-accent)"
												: "transparent"
										}
										borderWidth="0px"
										color={
											day.isToday
												? "white !important"
												: isHoliday
													? "red.400"
													: "panel.text"
										}
										fontWeight={
											day.isToday ? "700" : isHoliday ? "600" : "500"
										}
										fontSize="12px"
										boxShadow={
											day.isToday
												? "0 2px 8px var(--rb-panel-accent)"
												: undefined
										}
										transition="all 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
										cursor="default"
										_hover={
											day.isToday
												? undefined
												: {
														md: {
															bg: "panel.elevated",
															color: isHoliday
																? "red.400"
																: "panel.text",
														},
													}
										}
									>
										<Text>{day.label}</Text>
									</Flex>
								);
							})}
						</SimpleGrid>
					</motion.div>
				</AnimatePresence>
			</Box>

			{isChristmas && christmasRange && (
				<Text
					fontSize="10px"
					color="panel.textMuted"
					textAlign="center"
					pt={1}
				>
					{t("season.window")} ({christmasRange})
				</Text>
			)}
		</Stack>
	);

	if (inMenu) {
		return (
			<Menu
				placement={placement ?? (isRTL ? "left-start" : "right-start")}
				strategy="fixed"
				isLazy={false}
				autoSelect={false}
				gutter={6}
				computePositionOnMount
				modifiers={popperModifiers}
				isOpen={isMenuOpen}
				onOpen={() => {
					if (!isControlled) onOpen();
				}}
				onClose={handleMenuClose}
				closeOnSelect={false}
				closeOnBlur={false}
			>
				<MenuButton
					as={Button}
					variant="ghost"
					data-submenu-trigger="true"
					data-calendar-trigger="true"
					w="full"
					h="38px"
					justifyContent="flex-start"
					fontWeight="500"
					fontSize="13px"
					borderRadius="12px"
					px={3}
					bg={isPressing || isMenuOpen ? "panel.elevated" : "transparent"}
					color="panel.text"
					transform={isPressing ? "scale(0.96)" : undefined}
					transition="all 0.12s cubic-bezier(0.2, 0, 0, 1)"
					_hover={{ md: { bg: "panel.elevated" } }}
					_active={{ bg: "panel.elevated", transform: "scale(0.96)" }}
					_focusVisible={{ bg: "panel.elevated" }}
					onClick={(e: ReactMouseEvent) => {
						e.stopPropagation();
						handleToggle();
					}}
				>
					<HStack justify="space-between" w="full" minW={0} spacing={2.5}>
						<HStack spacing={2.5} minW={0}>
							<CalendarIcon flexShrink={0} color="panel.text" />
							<Text noOfLines={1} color="panel.text" fontSize="13px" fontWeight="500">
								{t("header.calendar", "Calendar")}
							</Text>
						</HStack>
						<Text
							fontSize="11px"
							fontWeight="600"
							color="panel.textMuted"
							isTruncated
						>
							{formattedDate}
						</Text>
					</HStack>
				</MenuButton>
				<Portal>
					<MenuList
						dir={isRTL ? "rtl" : "ltr"}
						data-profile-window="true"
						data-profile-submenu="true"
						data-calendar-menu-list="true"
						w="fit-content"
						minW="300px"
						p={3.5}
						borderRadius="20px"
						borderWidth="1px"
						borderColor={cardBorder}
						bg={cardBg}
						boxShadow={popoverHighlight}
						zIndex={10005}
						userSelect="none"
					>
						{renderCalendarBody()}
					</MenuList>
				</Portal>
			</Menu>
		);
	}

	return (
		<Popover
			isOpen={isOpen}
			onOpen={onOpen}
			onClose={onClose}
			closeOnBlur={true}
			closeOnEsc={true}
			placement={placement ?? (isRTL ? "bottom-start" : "bottom-end")}
			gutter={8}
		>
			<PopoverTrigger>
				<Button
					data-header-calendar-trigger="true"
					size="sm"
					variant="outline"
					h="34px"
					w={showText ? "auto" : "34px"}
					minW={showText ? "auto" : "34px"}
					px={showText ? 3 : 0}
					borderRadius={isCircle ? "full" : "12px"}
					borderColor={headerBtnBorder}
					bg={headerBtnBg}
					color="panel.text"
					boxShadow="sm"
					display="inline-flex"
					alignItems="center"
					justifyContent="center"
					gap={showText ? 2 : 0}
					title={formattedDate}
					aria-label={formattedDate}
					_hover={{
						md: {
							bg: "panel.elevated",
							borderColor: "panel.borderStrong",
							boxShadow: "0 4px 14px rgba(0, 0, 0, 0.08)",
						},
					}}
					_active={{ bg: "panel.elevated", transform: "scale(0.98)" }}
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
				>
					<Flex
						w="16px"
						h="16px"
						align="center"
						justify="center"
						color="panel.text"
						flexShrink={0}
					>
						<CalendarIcon style={{ width: "15px", height: "15px" }} />
					</Flex>
					{showText && (
						<Text
							noOfLines={1}
							maxW="320px"
							fontWeight="600"
							fontSize="12px"
							lineHeight="normal"
							color="panel.text"
						>
							{formattedDate}
						</Text>
					)}
				</Button>
			</PopoverTrigger>
			<Portal>
				<PopoverContent
					data-header-calendar-content="true"
					w="fit-content"
					minW="300px"
					p={3.5}
					borderRadius="20px"
					borderWidth="1px"
					borderColor={cardBorder}
					bg={cardBg}
					boxShadow={popoverHighlight}
					_focus={{ outline: "none" }}
					zIndex={9999}
				>
					<PopoverBody p={0}>
						{renderCalendarBody()}
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);
});
