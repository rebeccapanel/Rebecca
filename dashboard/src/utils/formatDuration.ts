const UNIT_LABELS = [
	{ label: "d", seconds: 24 * 60 * 60 },
	{ label: "h", seconds: 60 * 60 },
	{ label: "m", seconds: 60 },
	{ label: "s", seconds: 1 },
];

export const formatDuration = (value: number = 0) => {
	const totalSeconds = Math.max(0, Math.floor(value));
	if (totalSeconds === 0) {
		return "0s";
	}

	const parts: string[] = [];
	let remaining = totalSeconds;
	for (const unit of UNIT_LABELS) {
		const amount = Math.floor(remaining / unit.seconds);
		if (amount > 0) {
			parts.push(`${amount}${unit.label}`);
			remaining -= amount * unit.seconds;
		}
	}

	return parts.join(" ");
};
