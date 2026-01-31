import dayjs from "dayjs";
import i18n from "i18next";

const unitKeyMap: Record<
	"years" | "months" | "days" | "hours" | "minutes",
	string
> = {
	years: "time.years",
	months: "time.months",
	days: "time.days",
	hours: "time.hours",
	minutes: "time.minutes",
};

export type RelativeTimeUnit = keyof typeof unitKeyMap;
export type RelativeTimePart = { value: number; unit: RelativeTimeUnit };

const enforceNoBreak = (value: string) => value.replace(/\s+/, "\u00A0");

export const formatUnit = (value: number, unit: RelativeTimeUnit): string => {
	const abs = Math.abs(value);
	const label = i18n.t(unitKeyMap[unit], {
		count: abs,
		defaultValue: `${abs} ${unit.slice(0, -1)}${abs !== 1 ? "s" : ""}`,
	});
	return enforceNoBreak(label);
};

export const buildRelativeTimeParts = (
	fromUnixSeconds: number,
	toUnixSeconds: number,
): RelativeTimePart[] => {
	const from = dayjs.unix(fromUnixSeconds).utc();
	const to = dayjs.unix(toUnixSeconds).utc();
	const isForward = from.isBefore(to);
	const start = isForward ? from : to;
	const end = isForward ? to : from;
	const diffSeconds = Math.max(0, end.diff(start, "second"));
	const diffHours = Math.floor(diffSeconds / 3600);
	const diffMonths = end.diff(start, "month");

	if (diffHours < 72) {
		const hours = Math.floor(diffSeconds / 3600);
		const minutes = Math.floor((diffSeconds % 3600) / 60);
		return [
			{ value: hours, unit: "hours" },
			{ value: minutes, unit: "minutes" },
		];
	}

	if (diffMonths >= 12) {
		const years = end.diff(start, "year");
		const afterYears = start.add(years, "year");
		const months = end.diff(afterYears, "month");
		return [
			{ value: years, unit: "years" },
			{ value: months, unit: "months" },
		];
	}

	if (diffMonths >= 1) {
		const afterMonths = start.add(diffMonths, "month");
		const days = end.diff(afterMonths, "day");
		return [
			{ value: diffMonths, unit: "months" },
			{ value: days, unit: "days" },
		];
	}

	const days = Math.floor(diffSeconds / 86400);
	const hours = Math.floor((diffSeconds % 86400) / 3600);
	return [
		{ value: days, unit: "days" },
		{ value: hours, unit: "hours" },
	];
};

export const formatRelativeTimeParts = (parts: RelativeTimePart[]): string => {
	const nonZeroParts = parts.filter((part) => part.value > 0);
	const labels = nonZeroParts.map((part) => formatUnit(part.value, part.unit));
	if (labels.length === 0) {
		return "";
	}
	try {
		const formatter = new Intl.ListFormat(i18n.language || "en", {
			style: "long",
			type: "conjunction",
		});
		return formatter.format(labels);
	} catch (error) {
		console.warn("ListFormat not available, falling back to join", error);
		return labels.join(", ");
	}
};

export const relativeExpiryDate = (expiryDate: number | null | undefined) => {
	const dateInfo = { status: "", time: "" };
	if (expiryDate !== null && expiryDate !== undefined) {
		if (
			dayjs(expiryDate * 1000)
				.utc()
				.isAfter(dayjs().utc())
		) {
			dateInfo.status = "expires";
		} else {
			dateInfo.status = "expired";
		}
		const now = dayjs().utc();
		const target = dayjs(expiryDate * 1000).utc();
		const parts = buildRelativeTimeParts(now.unix(), target.unix());
		dateInfo.time = formatRelativeTimeParts(parts);
	}
	return dateInfo;
};
