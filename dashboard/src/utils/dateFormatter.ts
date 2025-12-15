import dayjs from "dayjs";
import i18n from "i18next";

const unitKeyMap: Record<"years" | "months" | "days" | "hours" | "minutes", string> =
	{
		years: "time.years",
		months: "time.months",
		days: "time.days",
		hours: "time.hours",
		minutes: "time.minutes",
	};

const formatUnit = (value: number, unit: keyof typeof unitKeyMap): string => {
	const abs = Math.abs(value);
	return i18n.t(unitKeyMap[unit], {
		count: abs,
		defaultValue: `${abs} ${unit.slice(0, -1)}${abs !== 1 ? "s" : ""}`,
	});
};

export const relativeExpiryDate = (expiryDate: number | null | undefined) => {
	const dateInfo = { status: "", time: "" };
	if (expiryDate) {
		if (
			dayjs(expiryDate * 1000)
				.utc()
				.isAfter(dayjs().utc())
		) {
			dateInfo.status = "expires";
		} else {
			dateInfo.status = "expired";
		}
		const durationSlots: string[] = [];
		const duration = dayjs
			.duration(
				dayjs(expiryDate * 1000)
					.utc()
					.diff(dayjs()),
			)
			.locale(i18n.language || "en");
		if (duration.years() !== 0) {
			durationSlots.push(formatUnit(duration.years(), "years"));
		}
		if (duration.months() !== 0) {
			durationSlots.push(formatUnit(duration.months(), "months"));
		}
		if (duration.days() !== 0) {
			durationSlots.push(formatUnit(duration.days(), "days"));
		}
		if (durationSlots.length === 0) {
			if (duration.hours() !== 0) {
				durationSlots.push(formatUnit(duration.hours(), "hours"));
			}
			if (duration.minutes() !== 0) {
				durationSlots.push(formatUnit(duration.minutes(), "minutes"));
			}
		}
		if (durationSlots.length > 0) {
			try {
				const formatter = new Intl.ListFormat(i18n.language || "en", {
					style: "long",
					type: "conjunction",
				});
				dateInfo.time = formatter.format(durationSlots);
			} catch (error) {
				console.warn("ListFormat not available, falling back to join", error);
				dateInfo.time = durationSlots.join(", ");
			}
		}
	}
	return dateInfo;
};
