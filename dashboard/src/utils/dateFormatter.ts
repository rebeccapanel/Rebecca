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

const RTL_LANGUAGE_RE = /^(fa|ar|he|ur)(-|_)?/i;

const getLanguage = () => i18n.resolvedLanguage || i18n.language || "en";

const isRtlLanguage = () => RTL_LANGUAGE_RE.test(getLanguage());

const enforceNoBreak = (value: string) => value.replace(/\s+/g, "\u00A0");

const isolateBidi = (value: string) =>
	isRtlLanguage() ? `\u2068${value}\u2069` : value;

const getPersianMonthNumber = (date: Date) => {
	try {
		const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
			month: "numeric",
			timeZone: "Asia/Tehran",
		}).formatToParts(date);
		const month = Number(parts.find((part) => part.type === "month")?.value);
		return Number.isFinite(month) ? month : null;
	} catch {
		return null;
	}
};

const getDisplayMonthLengthDays = (startUnixSeconds: number) => {
	if (!getLanguage().toLowerCase().startsWith("fa")) {
		return null;
	}
	const persianMonth = getPersianMonthNumber(
		new Date(startUnixSeconds * 1000),
	);
	if (!persianMonth) {
		return null;
	}
	return persianMonth <= 6 ? 31 : 30;
};

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

	if (diffHours < 72) {
		const hours = Math.floor(diffSeconds / 3600);
		const minutes = Math.floor((diffSeconds % 3600) / 60);
		return [
			{ value: hours, unit: "hours" },
			{ value: minutes, unit: "minutes" },
		];
	}

	const days = Math.floor(diffSeconds / 86400);
	const hours = Math.floor((diffSeconds % 86400) / 3600);
	const monthLengthDays = getDisplayMonthLengthDays(start.unix());

	if (monthLengthDays && days >= monthLengthDays && days < 365) {
		const months = Math.floor(days / monthLengthDays);
		const remainingDays = days % monthLengthDays;
		return [
			{ value: months, unit: "months" },
			{ value: remainingDays, unit: "days" },
		];
	}

	if (days >= 365) {
		const years = Math.floor(days / 365);
		const remainingDays = days % 365;
		return [
			{ value: years, unit: "years" },
			{ value: remainingDays, unit: "days" },
		];
	}

	return [
		{ value: days, unit: "days" },
		{ value: hours, unit: "hours" },
	];
};

export const formatRelativeTimeParts = (parts: RelativeTimePart[]): string => {
	const nonZeroParts = parts.filter((part) => part.value !== 0);
	const labels = nonZeroParts.map((part) => formatUnit(part.value, part.unit));
	if (labels.length === 0) {
		return "";
	}
	if (isRtlLanguage()) {
		return labels.map(isolateBidi).join(" و ");
	}
	try {
		const formatter = new Intl.ListFormat(getLanguage(), {
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
