import { chakra, Text } from "@chakra-ui/react";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	buildRelativeTimeParts,
	formatRelativeTimeParts,
} from "utils/dateFormatter";

const DAY_SECONDS = 86400;
const URGENT_WINDOW_SECONDS = DAY_SECONDS;

type UserExpiryCountdownProps = {
	/** Expiry timestamp in unix seconds; null/0 means the user never expires. */
	expire?: number | null;
};

type Urgency = "none" | "soon" | "urgent" | "expired";

const pad = (value: number) => String(value).padStart(2, "0");

const formatClock = (remainingSeconds: number): string => {
	const hours = Math.floor(remainingSeconds / 3600);
	const minutes = Math.floor((remainingSeconds % 3600) / 60);
	const seconds = remainingSeconds % 60;
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const getUrgency = (remainingSeconds: number): Urgency => {
	if (remainingSeconds <= 0) return "expired";
	if (remainingSeconds <= URGENT_WINDOW_SECONDS) return "urgent";
	if (remainingSeconds <= 3 * DAY_SECONDS) return "soon";
	return "none";
};

const URGENCY_COLORS: Record<Urgency, string> = {
	none: "panel.text",
	soon: "orange.400",
	urgent: "red.400",
	expired: "red.400",
};

/**
 * Live expiry countdown for the expanded user card. Within the last 24 hours
 * it ticks every second as HH:MM:SS; further out it re-renders the relative
 * label once per half-minute so the value never goes stale on screen.
 */
export const UserExpiryCountdown: FC<UserExpiryCountdownProps> = ({
	expire,
}) => {
	const { t } = useTranslation();
	const [nowSeconds, setNowSeconds] = useState(() =>
		Math.floor(Date.now() / 1000),
	);
	const remaining = expire ? expire - nowSeconds : null;
	const ticksEverySecond =
		remaining !== null && remaining > 0 && remaining <= URGENT_WINDOW_SECONDS;

	useEffect(() => {
		if (!expire) return;
		const interval = window.setInterval(
			() => setNowSeconds(Math.floor(Date.now() / 1000)),
			ticksEverySecond ? 1000 : 30000,
		);
		return () => window.clearInterval(interval);
	}, [expire, ticksEverySecond]);

	if (!expire || remaining === null) {
		return (
			<Text fontSize="sm" color="panel.textMuted">
				-
			</Text>
		);
	}

	const urgency = getUrgency(remaining);
	const relativeTime = formatRelativeTimeParts(
		buildRelativeTimeParts(nowSeconds, expire),
		{ compact: true },
	);

	return (
		<Text
			className="rb-user-expiry-countdown"
			data-urgency={urgency}
			fontSize="sm"
			fontWeight="semibold"
			color={URGENCY_COLORS[urgency]}
			dir="auto"
			noOfLines={1}
		>
			{urgency === "urgent" ? (
				<chakra.span
					dir="ltr"
					sx={{ unicodeBidi: "isolate", fontVariantNumeric: "tabular-nums" }}
				>
					{formatClock(remaining)}
				</chakra.span>
			) : (
				t(urgency === "expired" ? "expired" : "expires", {
					time: relativeTime,
				})
			)}
		</Text>
	);
};
