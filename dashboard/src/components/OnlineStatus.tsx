import { Box, Text } from "@chakra-ui/react";
import type { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";

type UserStatusProps = {
	lastOnline: string | null;
};

const convertDateFormat = (lastOnline: string | null): number | null => {
	if (!lastOnline) {
		return null;
	}

	const date = new Date(`${lastOnline}Z`);
	return Math.floor(date.getTime() / 1000);
};

const buildDurationParts = (
	diffSeconds: number,
	t: (key: string, defaultValue?: string, options?: Record<string, any>) => string,
	isRTL: boolean,
): ReactNode[] => {
	const minutesTotal = Math.floor(diffSeconds / 60);
	const hours = Math.floor(minutesTotal / 60);
	const minutes = minutesTotal % 60;

	if (isRTL) {
		const parts: ReactNode[] = [];
		if (hours > 0) {
			parts.push(
				<Box as="span" key="h" display="inline-flex" gap={1} alignItems="center">
					<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{hours}
					</Box>
					{t("timeUnit.hours", "ساعت")}
				</Box>,
			);
		}
		if (minutes > 0) {
			parts.push(
				<Box as="span" key="m" display="inline-flex" gap={1} alignItems="center">
					<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{minutes}
					</Box>
					{t("timeUnit.minutes", "دقیقه")}
				</Box>,
			);
		}
		const withJoiner: ReactNode[] = [];
		parts.forEach((p, idx) => {
			withJoiner.push(p);
			if (idx < parts.length - 1) {
				withJoiner.push(<Text as="span" key={`and-${idx}`}>و</Text>);
			}
		});
		return withJoiner;
	}

	const parts: ReactNode[] = [];
	const addPart = (
		count: number,
		key: "hours" | "minutes",
		defaultSingular: string,
		defaultPlural: string,
	) => {
		if (count <= 0) return;
		const defaultLabel = count === 1 ? defaultSingular : defaultPlural;
		const label = t(`timeUnit.${key}`, defaultLabel);
		parts.push(
			<Box
				as="span"
				display="inline-flex"
				gap={1}
				alignItems="center"
				key={`${key}-${count}`}
			>
				<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
					{count}
				</Box>
				{label}
			</Box>,
		);
	};

	if (hours > 0) addPart(hours, "hours", "hour", "hours");
	if (minutes > 0 || parts.length === 0) addPart(minutes, "minutes", "minute", "minutes");

	return parts;
};

export const OnlineStatus: FC<UserStatusProps> = ({ lastOnline }) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = convertDateFormat(lastOnline);

	const timeDifferenceInSeconds = unixTime
		? currentTimeInSeconds - unixTime
		: null;

	if (!unixTime || timeDifferenceInSeconds === null) {
		return (
			<Text
				display="inline-flex"
				fontSize="xs"
				fontWeight="medium"
				ml="2"
				color="gray.600"
				_dark={{
					color: "gray.400",
				}}
				as="span"
				gap={1}
				alignItems="center"
			>
				{t("onlineStatus.notConnectedYet", "Not Connected Yet")}
			</Text>
		);
	}

	if (timeDifferenceInSeconds <= 60) {
		return (
			<Text
				display="inline-flex"
				fontSize="xs"
				fontWeight="medium"
				ml="2"
				color="gray.600"
				_dark={{
					color: "gray.400",
				}}
				as="span"
				gap={1}
				alignItems="center"
			>
				{t("onlineStatus.online", "Online")}
			</Text>
		);
	}

	const parts = buildDurationParts(timeDifferenceInSeconds, t, isRTL);

	return (
		<Text
			display="inline-flex"
			fontSize="xs"
			fontWeight="medium"
			ml="2"
			color="gray.600"
			_dark={{
				color: "gray.400",
			}}
			as="span"
			gap={1}
			alignItems="center"
			dir={isRTL ? "rtl" : "ltr"}
		>
			<Box as="span" display="inline-flex" gap={1} alignItems="center">
				{parts.map((part, idx) => (
					<Box as="span" key={idx} display="inline-flex" gap={1}>
						{part}
						{idx < parts.length - 1 ? <Box as="span" mx={0.5}></Box> : null}
					</Box>
				))}
			</Box>
			<Text as="span">{t("onlineStatus.ago", "ago")}</Text>
		</Text>
	);
};
