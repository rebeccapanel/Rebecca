import dayjs from "dayjs";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "components/ui/button";
import { NumberField } from "components/ui/number-field";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { cn } from "lib/cn";

type QuickSelect = { label: string; onClick: () => void };

type DateTimeFieldProps = {
	id?: string;
	value: Date | null;
	onChange: (date: Date | null) => void;
	placeholder: string;
	disabled?: boolean;
	minDate?: Date;
	quickSelects: QuickSelect[];
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A form-height date and time field. The calendar opens under the field, is capped to the space the viewport
 * leaves it, and flips above the field only when there is no room below.
 */
export const DateTimeField: FC<DateTimeFieldProps> = ({
	id,
	value,
	onChange,
	placeholder,
	disabled = false,
	minDate,
	quickSelects,
}) => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const selected = value ? dayjs(value) : null;
	const [month, setMonth] = useState(() => (selected ?? dayjs()).startOf("month"));
	const [time, setTime] = useState(() => ({ hour: selected?.hour() ?? 12, minute: selected?.minute() ?? 0 }));

	// Follow the value by its timestamp, so a parent re-render with a new Date object does not reset the month being browsed.
	const timestamp = value ? value.getTime() : null;
	useEffect(() => {
		if (timestamp === null) return;
		const next = dayjs(timestamp);
		setMonth(next.startOf("month"));
		setTime({ hour: next.hour(), minute: next.minute() });
	}, [timestamp]);

	const minDay = minDate ? dayjs(minDate).startOf("day") : null;
	const isBeforeMin = (date: dayjs.Dayjs) => Boolean(minDay && date.startOf("day").isBefore(minDay));
	const today = dayjs();
	const cells: Array<number | null> = [
		...Array.from({ length: month.day() }, () => null),
		...Array.from({ length: month.daysInMonth() }, (_, index) => index + 1),
	];
	const weekdays = Array.from({ length: 7 }, (_, index) => dayjs().startOf("week").add(index, "day").format("dd"));

	const pickDay = (day: number) => {
		const next = month.date(day).hour(time.hour).minute(time.minute).second(0).millisecond(0);
		if (isBeforeMin(next)) return;
		onChange(next.toDate());
	};

	const applyTime = (hour: number, minute: number) => {
		setTime({ hour, minute });
		if (selected) onChange(selected.hour(hour).minute(minute).second(0).millisecond(0).toDate());
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					id={id}
					type="button"
					disabled={disabled}
					className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-start text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
					<span dir="ltr" className={cn("truncate", !selected && "text-muted-foreground")}>
						{selected ? selected.format("YYYY/MM/DD HH:mm") : placeholder}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={6}
				avoidCollisions
				collisionPadding={12}
				className="max-h-[var(--radix-popover-content-available-height)] w-[17rem] overflow-y-auto p-3"
			>
				<div className="flex flex-col gap-3">
					<div className="flex gap-1.5 [&>button]:flex-1 [&>button]:px-1.5">
						{quickSelects.map((option) => (
							<button
								key={option.label}
								type="button"
								onClick={option.onClick}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{option.label}
							</button>
						))}
					</div>

					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">{month.format("MMMM YYYY")}</span>
						<div className="flex items-center">
							<button
								type="button"
								aria-label={t("dateTimePicker.previousMonth")}
								onClick={() => setMonth((current) => current.subtract(1, "month"))}
								className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
							>
								<ChevronLeft className="rtl:rotate-180" />
							</button>
							<button
								type="button"
								aria-label={t("dateTimePicker.nextMonth")}
								onClick={() => setMonth((current) => current.add(1, "month"))}
								className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
							>
								<ChevronRight className="rtl:rotate-180" />
							</button>
						</div>
					</div>

					<div className="grid grid-cols-7 justify-items-center gap-y-1 text-center">
						{weekdays.map((name) => (
							<span key={name} className="text-[0.7rem] text-muted-foreground">
								{name}
							</span>
						))}
						{cells.map((day, index) => {
							if (day === null) return <span key={`blank-${index}`} />;
							const date = month.date(day);
							const isSelected = selected ? selected.isSame(date, "day") : false;
							const isToday = today.isSame(date, "day");
							const disabledDay = isBeforeMin(date);
							return (
								<button
									key={day}
									type="button"
									disabled={disabledDay}
									aria-pressed={isSelected}
									onClick={() => pickDay(day)}
									className={cn(
										buttonVariants({ variant: isSelected ? "default" : "ghost", size: "icon-sm" }),
										"size-7 text-xs",
										isToday && !isSelected && "border border-primary",
										disabledDay && "opacity-40",
									)}
								>
									{day}
								</button>
							);
						})}
					</div>

					<div className="flex items-center justify-center gap-1.5 border-t border-panel-border pt-3">
						<div className="w-20">
							<NumberField
								value={pad(time.hour)}
								inputMode="numeric"
								min={0}
								max={23}
								onChange={(raw) => {
									const parsed = Number.parseInt(raw, 10);
									if (!Number.isNaN(parsed)) applyTime(clamp(parsed, 0, 23), time.minute);
								}}
							/>
						</div>
						<span className="text-sm text-muted-foreground">:</span>
						<div className="w-20">
							<NumberField
								value={pad(time.minute)}
								inputMode="numeric"
								min={0}
								max={59}
								onChange={(raw) => {
									const parsed = Number.parseInt(raw, 10);
									if (!Number.isNaN(parsed)) applyTime(time.hour, clamp(parsed, 0, 59));
								}}
							/>
						</div>
					</div>

					<div className="flex items-center justify-between">
						<button
							type="button"
							onClick={() => onChange(null)}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							{t("clear")}
						</button>
						<button type="button" onClick={() => setOpen(false)} className={buttonVariants({ size: "sm" })}>
							{t("dateTimePicker.done")}
						</button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
};
