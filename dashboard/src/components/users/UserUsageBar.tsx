import { Box, chakra, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import type { FC } from "react";
import { formatBytes } from "utils/formatByte";
import { getUsageTone, usageToneGradients } from "./userColors";

type UserUsageBarProps = {
	used: number;
	total: number | null;
	/**
	 * "compact" keeps the original single-block layout (bar, then a
	 * used/percent line) used for tight mobile cells. "detailed" is the
	 * desktop table layout: the bar and percentage share one row, and
	 * current usage (left) / lifetime usage (right) share a second row
	 * below it.
	 */
	variant?: "compact" | "detailed";
	lifetimeUsed?: number;
	lifetimeLabel?: string;
	resetLabel?: string;
};

// Fixed so the percent label never changes the bar's rendered width -
// "5%", "100%" and "∞" all sit in the same reserved slot.
const PERCENT_SLOT_WIDTH = "2.75em";

export const formatUsagePair = (used: number, total: number | null): string => {
	const [usedValue, usedUnit] = formatBytes(used, 2, true);
	if (total === 0 || total === null) return `${usedValue}${usedUnit}/∞`;

	const [totalValue, totalUnit] = formatBytes(total, 2, true);
	if (usedUnit === totalUnit) return `${usedValue}/${totalValue}${totalUnit}`;
	return `${usedValue}${usedUnit}/${totalValue}${totalUnit}`;
};

/**
 * Gradient usage meter for the Users list. The fill color shifts from green
 * through yellow to red as the consumed share grows; unlimited users get a
 * static blue bar instead of an indeterminate spinner.
 */
export const UserUsageBar: FC<UserUsageBarProps> = ({
	used,
	total,
	variant = "compact",
	lifetimeUsed,
	lifetimeLabel,
	resetLabel,
}) => {
	const isUnlimited = total === 0 || total === null;
	const percent = isUnlimited ? 0 : Math.min((used / (total || 1)) * 100, 100);
	const tone = getUsageTone(percent, isUnlimited);
	const fillWidth = isUnlimited ? "100%" : `${Math.max(percent, 2)}%`;
	const percentLabel = isUnlimited ? "∞" : `${Math.round(percent)}%`;

	const track = (
		<Box className="rb-user-usage-track" flex="1 1 auto" minW={0}>
			<Box
				className="rb-user-usage-fill"
				style={{
					width: fillWidth,
					backgroundImage: usageToneGradients[tone],
				}}
			/>
		</Box>
	);

	if (variant === "compact") {
		return (
			<Stack
				className="rb-user-usage"
				data-tone={tone}
				data-variant={variant}
				spacing={1}
				w="full"
				maxW="full"
				justify="center"
				overflow="hidden"
			>
				{track}
				<HStack
					justify="space-between"
					spacing={2}
					fontSize="xs"
					dir="ltr"
					w="full"
					minW={0}
					whiteSpace="nowrap"
				>
					<Text
						className="rb-user-usage-pair"
						noOfLines={1}
						minW={0}
						sx={{ unicodeBidi: "isolate" }}
					>
						{formatUsagePair(used, total)}
					</Text>
					<Text className="rb-user-usage-percent" flexShrink={0}>
						{percentLabel}
					</Text>
				</HStack>
			</Stack>
		);
	}

	// Detailed (desktop table): row 1 is the bar with the percentage fixed to
	// its right in a constant-width slot, so the bar's rendered width only
	// ever depends on the (fixed) column width - never on the digits shown,
	// the username, or any other row's content. Row 2 holds current usage on
	// the left and lifetime usage on the right, wrapping gracefully if the
	// column gets too narrow to fit both on one line.
	return (
		<Stack
			className="rb-user-usage"
			data-tone={tone}
			data-variant={variant}
			spacing={1.5}
			w="full"
			maxW="full"
			overflow="hidden"
		>
			<Flex align="center" gap={2} w="full" minW={0}>
				{track}
				<Text
					className="rb-user-usage-percent"
					flex={`0 0 ${PERCENT_SLOT_WIDTH}`}
					textAlign="end"
					dir="ltr"
				>
					{percentLabel}
				</Text>
			</Flex>
			<Flex
				align="center"
				flexWrap="wrap"
				columnGap={3}
				rowGap={0.5}
				w="full"
				minW={0}
				fontSize="xs"
				dir="ltr"
			>
				<Text
					className="rb-user-usage-pair"
					noOfLines={1}
					minW={0}
					flex="0 1 auto"
					textAlign="start"
					sx={{ unicodeBidi: "isolate" }}
				>
					{formatUsagePair(used, total)}
					{resetLabel ? ` · ${resetLabel}` : ""}
				</Text>
				{lifetimeUsed !== undefined && (
					<Text
						color="panel.textMuted"
						noOfLines={1}
						flexShrink={0}
						ms="auto"
						textAlign="end"
						sx={{ unicodeBidi: "isolate" }}
					>
						{lifetimeLabel ? `${lifetimeLabel}: ` : ""}
						<chakra.span fontWeight="semibold" color="panel.textSecondary">
							{formatBytes(lifetimeUsed)}
						</chakra.span>
					</Text>
				)}
			</Flex>
		</Stack>
	);
};
