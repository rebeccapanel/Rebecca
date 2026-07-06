import { Box, chakra, HStack, Stack, Text } from "@chakra-ui/react";
import type { FC } from "react";
import { formatBytes } from "utils/formatByte";
import { getUsageTone, usageToneGradients } from "./userColors";

type UserUsageBarProps = {
	used: number;
	total: number | null;
	/** "compact" renders a mini bar + single usage line for tight cells. */
	variant?: "compact" | "detailed";
	lifetimeUsed?: number;
	lifetimeLabel?: string;
	resetLabel?: string;
};

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
 * soft shimmering blue bar instead of an indeterminate spinner.
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

	const meter = (
		<Stack spacing={1} flex="1 1 auto" minW={0} justify="center">
			<Box className="rb-user-usage-track">
				<Box
					className="rb-user-usage-fill"
					style={{
						width: fillWidth,
						backgroundImage: usageToneGradients[tone],
					}}
				/>
			</Box>
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
					{variant === "detailed" && resetLabel ? ` · ${resetLabel}` : ""}
				</Text>
				<Text className="rb-user-usage-percent" flexShrink={0}>
					{isUnlimited ? "∞" : `${Math.round(percent)}%`}
				</Text>
			</HStack>
		</Stack>
	);

	if (variant === "compact") {
		return (
			<Stack
				className="rb-user-usage"
				data-tone={tone}
				data-variant={variant}
				spacing={0}
				w="full"
				maxW="full"
				justify="center"
				overflow="hidden"
			>
				{meter}
			</Stack>
		);
	}

	// Detailed: lifetime usage sits beside the meter, vertically centered,
	// so the desktop row stays a single compact line.
	return (
		<HStack
			className="rb-user-usage"
			data-tone={tone}
			data-variant={variant}
			spacing={4}
			align="center"
			w="full"
			maxW="full"
			overflow="hidden"
		>
			{meter}
			{lifetimeUsed !== undefined && (
				<Text
					fontSize="xs"
					color="panel.textMuted"
					noOfLines={1}
					flexShrink={0}
					textAlign="end"
					dir="ltr"
					sx={{ unicodeBidi: "isolate" }}
				>
					{lifetimeLabel ? `${lifetimeLabel}: ` : ""}
					<chakra.span fontWeight="semibold" color="panel.textSecondary">
						{formatBytes(lifetimeUsed)}
					</chakra.span>
				</Text>
			)}
		</HStack>
	);
};
