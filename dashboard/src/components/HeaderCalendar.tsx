import {
	Badge,
	Box,
	Button,
	chakra,
	HStack,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	IconButton,
	SimpleGrid,
	Stack,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import {
	CalendarDaysIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { useSeasonal } from "contexts/SeasonalContext";
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const CalendarIcon = chakra(CalendarDaysIcon, { baseStyle: { w: 4, h: 4 } });
const Sparkles = chakra(SparklesIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronLeft = chakra(ChevronLeftIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronRight = chakra(ChevronRightIcon, { baseStyle: { w: 4, h: 4 } });

type CalendarDay = {
	date: Date;
	label: string;
	isToday: boolean;
	weekday: number;
};

const buildMonthDays = (
	baseDate: Date,
	displayLocale: string,
	numberLocale: string,
	usePersianCalendar: boolean,
) => {
	const numericLocale = usePersianCalendar
		? "en-u-ca-persian"
		: "en-u-ca-gregory";
	const monthFormatter = new Intl.DateTimeFormat(numericLocale, {
		month: "numeric",
	});
	const dayFormatter = new Intl.DateTimeFormat(numericLocale, { day: "numeric" });
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
		days.push({
			date: new Date(cursor),
			label,
			isToday: cursor.toDateString() === baseDate.toDateString(),
			weekday: cursor.getDay(),
		});

		cursor = new Date(cursor);
		cursor.setDate(cursor.getDate() + 1);
	}

	return { monthLabel, days };
};

const buildWeekdayLabels = (locale: string) => {
	const start = new Date(2023, 0, 1); // Sunday
	return Array.from({ length: 7 }).map((_, index) =>
		new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
			new Date(start.getTime() + index * 24 * 60 * 60 * 1000),
		),
	);
};

export const HeaderCalendar: FC = () => {
	const { t, i18n } = useTranslation();
	const [today, setToday] = useState(() => new Date());
	const [displayDate, setDisplayDate] = useState(() => new Date());
	const { isChristmas, window: seasonWindow } = useSeasonal();
	const isPersian = i18n.language?.startsWith("fa");
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const displayLocale = isPersian
		? "fa-IR-u-ca-persian"
		: `${i18n.language || "en"}-u-ca-gregory`;
	const numberLocale = isPersian ? "fa-IR" : i18n.language || "en";
	const badgeBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
	const highlight = useColorModeValue("primary.600", "primary.200");
	const border = useColorModeValue("blackAlpha.200", "whiteAlpha.200");

	useEffect(() => {
		const timer = setInterval(() => setToday(new Date()), 60 * 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		setDisplayDate(new Date());
	}, [i18n.language]);

	const formattedDate = useMemo(
		() =>
			new Intl.DateTimeFormat(displayLocale, {
				weekday: "long",
				day: "numeric",
				month: "long",
				year: "numeric",
			}).format(today),
		[displayLocale, today],
	);

	const { monthLabel, days } = useMemo(
		() =>
			buildMonthDays(
				displayDate,
				displayLocale,
				numberLocale,
				Boolean(isPersian),
			),
		[displayDate, displayLocale, isPersian, numberLocale],
	);
	const weekdayLabels = useMemo(
		() => buildWeekdayLabels(displayLocale),
		[displayLocale],
	);

	const emptySlots = days.length ? days[0].weekday : 0;
	const weekendDays = isPersian ? [5] : [0];
	const prevIcon = isRTL ? <ChevronRight /> : <ChevronLeft />;
	const nextIcon = isRTL ? <ChevronLeft /> : <ChevronRight />;

	const christmasRange = useMemo(() => {
		if (!seasonWindow) return null;
		const locale = i18n.language || "en";
		const formatter = new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
		});
		return `${formatter.format(seasonWindow.start)} - ${formatter.format(seasonWindow.end)}`;
	}, [i18n.language, seasonWindow]);

	return (
		<Popover placement="bottom-start">
			<PopoverTrigger>
				<Button
					variant="ghost"
					size="sm"
					display={{ base: "none", md: "inline-flex" }}
					leftIcon={<CalendarIcon />}
					px={3}
				>
					<Text
						noOfLines={1}
						maxW="320px"
						fontWeight="semibold"
						fontSize="sm"
					>
						{formattedDate}
					</Text>
				</Button>
			</PopoverTrigger>
				<PopoverContent
					w="fit-content"
					minW="260px"
					borderColor={border}
					boxShadow="lg"
				>
					<PopoverArrow />
					<PopoverBody>
						<Stack spacing={3}>
							<HStack justify="space-between" align="center" dir={isRTL ? "rtl" : "ltr"}>
								<HStack spacing={2}>
									<IconButton
										size="xs"
										variant="ghost"
										aria-label="Previous month"
										icon={prevIcon}
										onClick={() => {
											const next = new Date(displayDate);
											next.setMonth(displayDate.getMonth() - 1);
											setDisplayDate(next);
										}}
									/>
									<Text fontWeight="semibold">{monthLabel}</Text>
									{isChristmas && (
										<Badge
											colorScheme="red"
											display="inline-flex"
											alignItems="center"
											gap={1}
										>
											<Sparkles />
											{t("season.christmas", "Christmas mode")}
										</Badge>
									)}
									<IconButton
										size="xs"
										variant="ghost"
										aria-label="Next month"
										icon={nextIcon}
										onClick={() => {
											const next = new Date(displayDate);
											next.setMonth(displayDate.getMonth() + 1);
											setDisplayDate(next);
										}}
									/>
								</HStack>
							</HStack>
						<SimpleGrid columns={7} spacing={1}>
							{weekdayLabels.map((label) => (
								<Text
									key={label}
									textAlign="center"
									fontSize="xs"
									color="gray.500"
									_dark={{ color: "gray.400" }}
									fontWeight="semibold"
								>
									{label}
								</Text>
							))}
							{Array.from({ length: emptySlots }).map((_, idx) => (
								<Box key={`empty-${idx}`} />
							))}
							{days.map((day) => {
								const isHoliday = weekendDays.includes(day.weekday);
								return (
									<Box
										key={day.date.toISOString()}
										textAlign="center"
										px={2}
										py={2}
										borderRadius="md"
										borderWidth={day.isToday ? "1px" : "0px"}
										borderColor={day.isToday ? highlight : "transparent"}
										bg={day.isToday ? badgeBg : "transparent"}
										fontWeight={day.isToday || isHoliday ? "semibold" : "normal"}
										color={isHoliday ? "red.500" : undefined}
									>
										<Text>{day.label}</Text>
									</Box>
								);
							})}
						</SimpleGrid>
						{isChristmas && christmasRange && (
							<Text fontSize="xs" color="gray.500" textAlign="center">
								{t("season.window", "Holiday cheer is on")} ({christmasRange})
							</Text>
						)}
					</Stack>
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);
};
