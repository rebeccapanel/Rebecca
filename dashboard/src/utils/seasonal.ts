export type SeasonWindow = {
	start: Date;
	end: Date;
};

const buildDate = (year: number, month: number, day: number) =>
	new Date(year, month, day, 0, 0, 0, 0);

export const getChristmasWindow = (referenceDate = new Date()) => {
	const year = referenceDate.getFullYear();
	const month = referenceDate.getMonth();
	// If we're already in Nov/Dec, start this year's window; otherwise use last year's window
	const seasonYear = month >= 10 ? year : year - 1;
	const start = buildDate(seasonYear, 11, 1); // Dec 1
	const end = buildDate(seasonYear + 1, 0, 7); // Jan 7 next year
	return { start, end };
};

export const isWithinWindow = (target: Date, window: SeasonWindow) => {
	return target >= window.start && target <= window.end;
};

export const isChristmasSeason = (
	target = new Date(),
	window = getChristmasWindow(target),
) => {
	return isWithinWindow(target, window);
};
