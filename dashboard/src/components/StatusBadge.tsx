import { Badge, Box, Text } from "@chakra-ui/react";

import { statusColors } from "constants/UserSettings";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Status as UserStatusType } from "types/User";
import { relativeExpiryDate } from "utils/dateFormatter";

type UserStatusProps = {
	expiryDate?: number | null;
	status: UserStatusType;
	compact?: boolean;
	showDetail?: boolean;
	detailPlacement?: "inline" | "below";
	extraText?: string | null;
};
export const StatusBadge: FC<UserStatusProps> = ({
	expiryDate,
	status: userStatus,
	compact = false,
	showDetail = true,
	detailPlacement = "inline",
	extraText,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const dateInfo = relativeExpiryDate(expiryDate, { compact });
	const Icon = statusColors[userStatus].icon;
	const isExpiry = dateInfo.status === "expires";

	const renderRelativeText = (key: "expires" | "expired") => {
		const raw = t(key);
		const [before = "", after = ""] = raw.split("{{time}}");
		const timeNode =
			dateInfo.time && dateInfo.time.length > 0 ? (
				<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }} key="time">
					{dateInfo.time}
				</Box>
			) : null;

		const nodes: JSX.Element[] = [];
		if (!isRTL) {
			if (before) {
				nodes.push(
					<Text as="span" key="before">
						{before}
					</Text>,
				);
			}
			if (timeNode) {
				nodes.push(timeNode);
			}
			if (after) {
				nodes.push(
					<Text as="span" key="after">
						{after}
					</Text>,
				);
			}
		} else {
			if (timeNode) {
				nodes.push(timeNode);
			}
			if (after) {
				nodes.push(
					<Text as="span" key="after">
						{after}
					</Text>,
				);
			}
			if (before) {
				nodes.push(
					<Text as="span" key="before">
						{before}
					</Text>,
				);
			}
		}
		return nodes;
	};
	return (
		<Box
			className="rb-status-badge-shell"
			display="inline-flex"
			alignItems={detailPlacement === "below" ? "flex-start" : "center"}
			justifyContent="flex-start"
			flexDirection={detailPlacement === "below" ? "column" : "row"}
			gap={detailPlacement === "below" ? 0.5 : 1.5}
			flexWrap="nowrap"
			dir={isRTL ? "rtl" : "ltr"}
			whiteSpace="nowrap"
			textAlign="start"
			maxW="full"
		>
			<Badge
				className="rb-status-badge"
				colorScheme={statusColors[userStatus].statusColor}
				rounded="full"
				display="inline-flex"
				px={compact ? 2 : 3}
				py={compact ? 0.5 : 1}
				columnGap={compact ? 1 : 1.5}
				alignItems="center"
				justifyContent="flex-start"
				flexWrap="nowrap"
				lineHeight="1"
				whiteSpace="nowrap"
				minW={compact ? "64px" : "72px"}
				maxW="full"
			>
				<Icon w={compact ? 3 : 4} flexShrink={0} />
				{showDetail && (
					<Text
						className="rb-status-badge-text"
						textTransform="capitalize"
						fontSize={compact ? ".68rem" : ".875rem"}
						lineHeight={compact ? "1rem" : "1.25rem"}
						fontWeight="medium"
						letterSpacing="0"
						whiteSpace="nowrap"
					>
						{userStatus && t(`status.${userStatus}`)}
						{extraText && `: ${extraText}`}
					</Text>
				)}
			</Badge>
			{showDetail &&
				expiryDate !== null &&
				expiryDate !== undefined &&
				dateInfo.time && (
					<Text
						display="block"
						fontSize="xs"
						fontWeight="medium"
						color="gray.600"
						_dark={{
							color: "gray.400",
						}}
						as="span"
						lineHeight="1.2"
						textAlign="start"
						whiteSpace="nowrap"
						pl={detailPlacement === "below" ? 1 : undefined}
					>
						{isExpiry
							? renderRelativeText("expires")
							: renderRelativeText("expired")}
					</Text>
				)}
		</Box>
	);
};
