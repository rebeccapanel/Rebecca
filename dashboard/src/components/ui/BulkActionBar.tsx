import {
	Box,
	Button,
	Flex,
	HStack,
	Text,
	type BoxProps,
} from "@chakra-ui/react";
import type { FC, PropsWithChildren, ReactNode } from "react";
import { useTranslation } from "react-i18next";

type BulkActionBarProps = PropsWithChildren<
	BoxProps & {
		selectedCount: number;
		onClear?: () => void;
		selectedLabel?: ReactNode;
	}
>;

export const BulkActionBar: FC<BulkActionBarProps> = ({
	selectedCount,
	onClear,
	selectedLabel,
	children,
	...props
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const isVisible = selectedCount > 0;
	const sidebarInset = {
		base: "12px",
		md: "calc(var(--rb-sidebar-offset, 0px) + 16px)",
	};

	return (
		<Box
			className="rb-bulk-action-bar"
			data-visible={isVisible ? "true" : undefined}
			aria-hidden={!isVisible}
			position="fixed"
			left={isRTL ? "16px" : sidebarInset}
			right={isRTL ? sidebarInset : "16px"}
			bottom={{ base: "84px", md: "16px" }}
			zIndex={1200}
			bg="panel.surface"
			borderWidth="1px"
			borderColor="panel.borderStrong"
			boxShadow="0 -12px 30px rgba(0, 0, 0, 0.28)"
			borderRadius="6px"
			px={{ base: 4, md: 6 }}
			py={4}
			opacity={isVisible ? 1 : 0}
			transform={isVisible ? "translateY(0)" : "translateY(10px)"}
			pointerEvents={isVisible ? "auto" : "none"}
			transition="opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background-color 140ms ease"
			{...props}
		>
			<Flex align="center" justify="space-between" gap={4} flexWrap="wrap">
				<HStack spacing={4}>
					<Text fontWeight="800" letterSpacing="0" textTransform="uppercase">
						{selectedLabel ??
								t("usersTable.selectedCount", "{{count}} selected", {
									count: selectedCount,
								})}
					</Text>
					{onClear && (
						<Button
							size="xs"
							variant="link"
							color="panel.textMuted"
							onClick={onClear}
						>
							{t("clear", "Clear")}
						</Button>
					)}
				</HStack>
				<HStack spacing={{ base: 2, md: 4 }} flexWrap="wrap" justify="flex-end">
					{children}
				</HStack>
			</Flex>
		</Box>
	);
};
