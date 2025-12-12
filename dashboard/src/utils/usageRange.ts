import dayjs, { type ManipulateType } from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export type RangeUnit = "day" | "hour";
export type UsagePreset<Key extends string = string> = {
	key: Key;
	label: string;
	amount: number;
	unit: RangeUnit;
};

export type RangeState<Key extends string = string> = {
	key: Key;
	start: Date;
	end: Date;
	unit: RangeUnit;
};

export const buildRangeFromPreset = <Key extends string>(
	preset: UsagePreset<Key>,
): RangeState<Key> => {
	const alignUnit: ManipulateType = preset.unit === "hour" ? "hour" : "day";
	const end = dayjs().utc().endOf(alignUnit);
	const span = Math.max(preset.amount - 1, 0);
	const start = end.subtract(span, preset.unit).startOf(alignUnit);

	return {
		key: preset.key,
		start: start.toDate(),
		end: end.toDate(),
		unit: preset.unit,
	};
};

export const normalizeCustomRange = (
	start: Date,
	end: Date,
): RangeState<"custom"> => {
	const startDate = dayjs(start);
	const endDate = dayjs(end);
	const [minDate, maxDate] = startDate.isBefore(endDate)
		? [startDate, endDate]
		: [endDate, startDate];
	const startAligned = minDate.startOf("day");
	const endAligned = maxDate.endOf("day");
	const isSingleDay = startAligned.isSame(endAligned, "day");

	return {
		key: "custom",
		start: startAligned.toDate(),
		end: endAligned.toDate(),
		unit: isSingleDay ? "hour" : "day",
	};
};
