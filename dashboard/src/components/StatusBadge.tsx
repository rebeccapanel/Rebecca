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
	extraText?: string | null;
};
export const StatusBadge: FC<UserStatusProps> = ({
	expiryDate,
	status: userStatus,
	compact = false,
	showDetail = true,
	extraText,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const dateInfo = relativeExpiryDate(expiryDate);
	const Icon = statusColors[userStatus].icon;
	const isExpiry = dateInfo.status === "expires";

	const renderRelativeText = (key: "expires" | "expired") => {
		const raw = t(key);
		const [before = "", after = ""] = raw.split("{{time}}");
		const trimmedBefore = before.trim();
		const trimmedAfter = after.trim();
		const timeNode =
			dateInfo.time && dateInfo.time.length > 0 ? (
				<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }} key="time">
					{dateInfo.time}
				</Box>
			) : null;

		const nodes: JSX.Element[] = [];
		if (!isRTL) {
			if (trimmedBefore) {
				nodes.push(
					<Text as="span" key="before">
						{trimmedBefore}
					</Text>,
				);
			}
			if (timeNode) {
				nodes.push(timeNode);
			}
			if (trimmedAfter) {
				nodes.push(
					<Text as="span" key="after">
						{trimmedAfter}
					</Text>,
				);
			}
		} else {
			if (timeNode) {
				nodes.push(timeNode);
			}
			if (trimmedAfter) {
				nodes.push(
					<Text as="span" key="after">
						{trimmedAfter}
					</Text>,
				);
			}
			if (trimmedBefore) {
				nodes.push(
					<Text as="span" key="before">
						{trimmedBefore}
					</Text>,
				);
			}
		}
		return nodes;
	};
	return (
		<Box
			display="inline-flex"
			alignItems="center"
			gap={2}
			flexWrap="wrap"
			dir={isRTL ? "rtl" : "ltr"}
		>
			<Badge
				colorScheme={statusColors[userStatus].statusColor}
				rounded="full"
				display="inline-flex"
				px={3}
				py={1}
				columnGap={compact ? 1 : 2}
				alignItems="center"
			>
				<Icon w={compact ? 3 : 4} />
				{showDetail && (
					<Text
						textTransform="capitalize"
						fontSize={compact ? ".7rem" : ".875rem"}
						lineHeight={compact ? "1rem" : "1.25rem"}
						fontWeight="medium"
						letterSpacing="tighter"
					>
						{userStatus && t(`status.${userStatus}`)}
						{extraText && `: ${extraText}`}
					</Text>
				)}
			</Badge>
			{showDetail && expiryDate && dateInfo.time && (
				<Text
					display="inline-flex"
					fontSize="xs"
					fontWeight="medium"
					color="gray.600"
					_dark={{
						color: "gray.400",
					}}
					as="span"
					gap={1}
					alignItems="center"
				>
					{isExpiry
						? renderRelativeText("expires")
						: renderRelativeText("expired")}
				</Text>
			)}
		</Box>
	);
};
