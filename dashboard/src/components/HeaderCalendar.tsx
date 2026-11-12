import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "components/ui/popover";
import { useSeasonal } from "contexts/SeasonalContext";
import { AnimatePresence, motion } from "framer-motion";
import { useDisclosure } from "hooks/useDisclosure";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Sparkles,
} from "lucide-react";
import {
	type FC,
	memo,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

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

const buildMonthDays = (
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
	const nowString = new Date().toDateString();

	const days: CalendarDay[] = [];
	let cursor = firstDay;
	while (monthFormatter.format(cursor) === monthId) {
		const label = numberFormatter.format(Number(dayFormatter.format(cursor)));
		const weekday = cursor.getDay();
		const weekdayIndex = usePersian ? (weekday + 1) % 7 : weekday;

		days.push({
			date: new Date(cursor),
			label,
			isToday: cursor.toDateString() === nowString,
			weekdayIndex,
		});

		cursor = new Date(cursor);
		cursor.setDate(cursor.getDate() + 1);
	}

	return { monthLabel, days };
};

const PERSIAN_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const GREGORIAN_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface HeaderCalendarProps {
	isCompact?: boolean;
	inMenu?: boolean;
	isOpen?: boolean;
	isPressing?: boolean;
	onToggle?: () => void;
	onClose?: () => void;
}

export const HeaderCalendar: FC<HeaderCalendarProps> = memo(
	function HeaderCalendar({
		isCompact = false,
		inMenu = false,
		isOpen: controlledIsOpen,
		isPressing = false,
		onToggle: controlledOnToggle,
		onClose: controlledOnClose,
	}) {
		const { t, i18n } = useTranslation();
		const [today, setToday] = useState(() => new Date());
		const [displayDate, setDisplayDate] = useState(() => new Date());
		const [monthDirection, setMonthDirection] = useState<1 | -1>(1);
		const { isChristmas, window: seasonWindow } = useSeasonal();
		const isDesktop = useMediaQuery("(min-width: 769px)");
		const isPersian = Boolean(i18n.language?.startsWith("fa"));
		const isRTL = i18n.dir(i18n.language) === "rtl";
		const showText = isDesktop && !isCompact;

		const displayLocale = isPersian
			? "fa-IR-u-ca-persian"
			: `${i18n.language || "en"}-u-ca-gregory`;
		const numberLocale = isPersian ? "fa-IR" : i18n.language || "en";

		const localDisclosure = useDisclosure();
		const isControlled = controlledIsOpen !== undefined;
		const isOpen = isControlled ? controlledIsOpen : localDisclosure.isOpen;

		const handleOpenChange = (nextOpen: boolean) => {
			if (isControlled) {
				if (nextOpen) controlledOnToggle?.();
				else controlledOnClose?.();
				return;
			}
			if (nextOpen) localDisclosure.onOpen();
			else localDisclosure.onClose();
		};

		useEffect(() => {
			const timer = window.setInterval(() => setToday(new Date()), 60 * 1000);
			return () => window.clearInterval(timer);
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
				buildMonthDays(
					displayDate,
					displayLocale,
					numberLocale,
					isPersian,
				),
			[displayDate, displayLocale, isPersian, numberLocale],
		);

		const weekdayLabels = isPersian ? PERSIAN_WEEKDAYS : GREGORIAN_WEEKDAYS;
		const emptySlots = days.length ? days[0].weekdayIndex : 0;
		const emptySlotKeys = useMemo(
			() => Array.from({ length: emptySlots }, () => createStableKey()),
			[emptySlots],
		);

		const holidayWeekdayIndex = isPersian ? 6 : 0;
		const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
		const NextIcon = isRTL ? ChevronLeft : ChevronRight;

		const isCurrentMonth = useMemo(
			() =>
				displayDate.getFullYear() === today.getFullYear() &&
				displayDate.getMonth() === today.getMonth(),
			[displayDate, today],
		);

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

		const calendarContent = (
			<div
				dir={isRTL ? "rtl" : "ltr"}
				className="flex flex-col gap-3 select-none"
			>
				<div className="flex items-center justify-between gap-2 px-1">
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							aria-label={t("dateTimePicker.previousMonth")}
							onClick={handlePrevMonth}
							className="inline-flex size-6 items-center justify-center rounded-[7px] border border-panel-border! bg-panel-surface text-panel-text-secondary transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.92] min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							<PrevIcon className="size-3.5" />
						</button>
						<button
							type="button"
							aria-label={t("dateTimePicker.nextMonth")}
							onClick={handleNextMonth}
							className="inline-flex size-6 items-center justify-center rounded-[7px] border border-panel-border! bg-panel-surface text-panel-text-secondary transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.92] min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
						>
							<NextIcon className="size-3.5" />
						</button>
					</div>

					<div className="flex items-center gap-2">
						<span className="text-[13px] font-bold text-panel-text">
							{monthLabel}
						</span>
						{isChristmas ? (
							<Badge className="inline-flex items-center gap-1 rounded-full bg-destructive/12 px-2 py-0.5 text-[10px] font-semibold text-destructive">
								<Sparkles className="size-3" />
								{t("season.christmas")}
							</Badge>
						) : null}
					</div>

					<button
						type="button"
						onClick={handleResetToday}
						className={cn(
							"inline-flex h-6 items-center justify-center rounded-[7px] border px-2 text-[11px] font-semibold transition-[background-color,border-color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94] min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated",
							isCurrentMonth
								? "border-transparent! bg-transparent text-panel-text-secondary opacity-75"
								: "border-panel-border-strong! bg-panel-elevated text-panel-text opacity-100",
						)}
					>
						{t("calendar.today", "Today")}
					</button>
				</div>

				<div className="grid grid-cols-7 gap-1 px-1">
					{weekdayLabels.map((label, idx) => {
						const isHoliday = idx === holidayWeekdayIndex;
						return (
							<span
								key={label}
								className={cn(
									"py-0.5 text-center text-[11px] font-bold",
									isHoliday ? "text-red-400" : "text-panel-text-muted",
								)}
							>
								{label}
							</span>
						);
					})}
				</div>

				<div className="relative min-h-[212px] overflow-hidden">
					<AnimatePresence
						initial={false}
						custom={monthDirection}
						mode="wait"
					>
						<motion.div
							key={monthLabel}
							initial={{ opacity: 0, x: monthDirection * 18 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -monthDirection * 18 }}
							transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
						>
							<div className="grid grid-cols-7 gap-1 px-1">
								{emptySlotKeys.map((key) => (
									<div key={key} className="size-[34px]" />
								))}
								{days.map((day) => {
									const isHoliday = day.weekdayIndex === holidayWeekdayIndex;
									return (
										<div
											key={day.date.toISOString()}
											className={cn(
												"flex size-[34px] items-center justify-center rounded-[9px] text-xs transition-colors duration-150",
												day.isToday
													? "bg-panel-accent font-bold text-white shadow-[0_2px_8px_color-mix(in_srgb,var(--rb-panel-accent)_40%,transparent)]"
													: cn(
															"bg-transparent min-[769px]:hover:bg-panel-elevated",
															isHoliday
																? "font-semibold text-red-400"
																: "font-medium text-panel-text",
														),
											)}
										>
											<span>{day.label}</span>
										</div>
									);
								})}
							</div>
						</motion.div>
					</AnimatePresence>
				</div>

				{isChristmas && christmasRange ? (
					<p className="pt-1 text-center text-[10px] text-panel-text-muted">
						{t("season.window")} ({christmasRange})
					</p>
				) : null}
			</div>
		);

		if (inMenu) {
			return (
				<Popover open={isOpen} onOpenChange={handleOpenChange}>
					<PopoverTrigger asChild>
						<button
							type="button"
							data-submenu-trigger="true"
							data-calendar-trigger="true"
							onClick={(e: ReactMouseEvent) => {
								e.stopPropagation();
								if (controlledOnToggle) controlledOnToggle();
								else handleOpenChange(!isOpen);
							}}
							className={cn(
								"flex h-[38px] w-full items-center justify-between gap-2.5 rounded-[12px] px-3 text-[13px] font-medium text-panel-text transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.97] active:bg-panel-elevated focus-visible:bg-panel-elevated min-[769px]:hover:bg-panel-elevated",
								isPressing || isOpen ? "bg-panel-elevated" : "bg-transparent",
								isPressing && "scale-[0.97]",
							)}
						>
							<span className="flex min-w-0 items-center gap-2.5">
								<CalendarDays
									className="size-4 shrink-0 text-panel-text"
									strokeWidth={1.75}
								/>
								<span className="truncate">
									{t("header.calendar", "Calendar")}
								</span>
							</span>
							<span className="truncate text-[11px] font-semibold text-panel-text-muted">
								{formattedDate}
							</span>
						</button>
					</PopoverTrigger>
					<PopoverContent
						dir={isRTL ? "rtl" : "ltr"}
						data-profile-window="true"
						data-profile-submenu="true"
						data-calendar-menu-list="true"
						side={isDesktop ? (isRTL ? "left" : "right") : "bottom"}
						align={isDesktop ? "start" : "center"}
						sideOffset={8}
						collisionPadding={12}
						className="z-[10005] w-[min(308px,calc(100vw-24px))] max-w-[calc(100vw-16px)] max-h-[min(calc(var(--radix-popover-content-available-height,72dvh)-8px),calc(100dvh-24px))] overflow-y-auto overscroll-contain rounded-[20px] border border-panel-border! bg-panel-surface p-3.5 text-panel-text shadow-[0_20px_48px_rgba(0,0,0,0.35)]"
					>
						{calendarContent}
					</PopoverContent>
				</Popover>
			);
		}

		return (
			<Popover open={isOpen} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-header-calendar-trigger="true"
						title={formattedDate}
						aria-label={formattedDate}
						className={cn(
							"h-[34px] border-panel-border! bg-panel-surface text-panel-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-panel-surface dark:hover:bg-input/30 active:scale-[0.97] active:bg-panel-elevated min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:dark:hover:bg-panel-elevated min-[769px]:hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
							showText
								? "w-auto min-w-0 rounded-[12px] px-3 gap-2"
								: "size-[34px] min-w-[34px]! rounded-full px-0 min-[769px]:rounded-[12px]",
						)}
					>
						<CalendarDays
							className="size-4 shrink-0 text-panel-text"
							strokeWidth={1.75}
						/>
						{showText ? (
							<span className="max-w-[300px] truncate text-xs font-semibold leading-normal text-panel-text">
								{formattedDate}
							</span>
						) : null}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					dir={isRTL ? "rtl" : "ltr"}
					data-header-calendar-content="true"
					align={isRTL ? "start" : "end"}
					sideOffset={8}
					collisionPadding={12}
					className="z-[9999] w-[min(308px,calc(100vw-24px))] max-w-[calc(100vw-16px)] max-h-[min(calc(var(--radix-popover-content-available-height,76dvh)-8px),calc(100dvh-24px))] overflow-y-auto overscroll-contain rounded-[20px] border border-panel-border! bg-panel-surface p-3.5 text-panel-text shadow-[0_20px_48px_rgba(0,0,0,0.32)] sm:w-fit sm:min-w-[296px]!"
				>
					{calendarContent}
				</PopoverContent>
			</Popover>
		);
	},
);

