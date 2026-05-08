import {
	Box,
	type BoxProps,
	ModalBody,
	type ModalBodyProps,
	ModalContent,
	type ModalContentProps,
	ModalFooter,
	type ModalFooterProps,
	ModalHeader,
	type ModalHeaderProps,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import type { FC, ReactNode } from "react";

// UX credit: Xray edit dialogs follow the compact Ant Design/3x-ui form rhythm:
// tight headers, section panels, small controls, and explicit footer actions.
export const XrayModalContent: FC<ModalContentProps> = ({
	children,
	sx,
	...props
}) => {
	const bg = useColorModeValue("white", "surface.dark");
	const bodyBg = useColorModeValue("gray.50", "blackAlpha.300");
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.300");
	const sectionBg = useColorModeValue("white", "whiteAlpha.50");
	const fieldBg = useColorModeValue("white", "blackAlpha.200");
	const labelColor = useColorModeValue("gray.700", "gray.200");
	const mutedColor = useColorModeValue("gray.500", "gray.400");
	const tabActiveBg = useColorModeValue("primary.500", "whiteAlpha.200");
	const tabActiveColor = useColorModeValue("white", "white");
	const tabActiveBorder = useColorModeValue("primary.500", "primary.300");

	return (
		<ModalContent
			bg={bg}
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			overflow="hidden"
			maxH={{
				base: "var(--rb-dialog-viewport-height, 100dvh)",
				md: "calc(100vh - 48px)",
			}}
			h={{ base: "var(--rb-dialog-viewport-height, 100dvh)", md: "auto" }}
			display="flex"
			flexDirection="column"
			boxShadow="xl"
			sx={{
				"@media (max-width: 48em)": {
					width: "100vw !important",
					maxWidth: "100vw !important",
					height: "var(--rb-dialog-viewport-height, 100dvh) !important",
					maxHeight: "var(--rb-dialog-viewport-height, 100dvh) !important",
					margin: "0 !important",
					borderRadius: "0 !important",
				},
				".chakra-modal__body": {
					bg: bodyBg,
					minH: 0,
					overflowY: "auto",
					overflowX: "hidden",
					WebkitOverflowScrolling: "touch",
					overscrollBehavior: "contain",
				},
				".chakra-modal__header": {
					bg,
					borderBottom: "1px solid",
					borderColor,
					flexShrink: 0,
				},
				".chakra-modal__footer": {
					bg,
					borderTop: "1px solid",
					borderColor,
					flexShrink: 0,
				},
				".chakra-form__label": {
					mb: 1,
					color: labelColor,
					fontSize: "xs",
					fontWeight: "semibold",
					lineHeight: 1.35,
				},
				".chakra-form__helper-text": {
					color: mutedColor,
					fontSize: "xs",
					mt: 1,
				},
				".chakra-form__error-message": {
					fontSize: "xs",
					mt: 1,
				},
				"input, select, textarea": {
					bg: fieldBg,
					borderRadius: "4px",
					fontSize: "13px",
					width: "100%",
				},
				".chakra-input__group, .chakra-numberinput, .chakra-select__wrapper": {
					width: "100%",
				},
				".chakra-form-control > .chakra-stack, .chakra-form-control > .chakra-wrap, .chakra-form-control > .chakra-box":
					{
						width: "100%",
					},
				textarea: {
					minH: "68px",
				},
				".chakra-tabs__tablist": {
					gap: "8px",
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					bg,
					p: "6px",
					mb: 3,
				},
				".chakra-tabs__tab": {
					border: "1px solid transparent",
					borderRadius: "5px",
					px: 3,
					py: 1.5,
					minH: "30px",
					fontSize: "13px",
					fontWeight: "semibold",
					color: mutedColor,
				},
				".chakra-tabs__tab[aria-selected=true]": {
					bg: tabActiveBg,
					borderColor: tabActiveBorder,
					color: tabActiveColor,
				},
				".xray-dialog-section": {
					bg: sectionBg,
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					p: { base: 3, md: 3 },
				},
				".xray-dialog-section .chakra-form-control": {
					display: "block",
					minW: 0,
				},
				".xray-dialog-section .chakra-form-control > .chakra-form__helper-text, .xray-dialog-section .chakra-form-control > .chakra-form__error-message":
					{
						gridColumn: "auto",
					},
				".xray-dialog-section .chakra-form-control > .chakra-stack, .xray-dialog-section .chakra-form-control > .chakra-wrap, .xray-dialog-section .chakra-form-control > .chakra-button, .xray-dialog-section .chakra-form-control > .chakra-text, .xray-dialog-section .chakra-form-control > .chakra-box, .xray-dialog-section .chakra-form-control > .chakra-alert":
					{
						gridColumn: "auto",
					},
				".xray-dialog-section .chakra-form-control > .chakra-checkbox__control + span":
					{
						fontSize: "13px",
					},
				".xray-dialog-switch-row": {
					border: "1px solid",
					borderColor,
					borderRadius: "6px",
					bg: sectionBg,
					px: 3,
					py: 2,
				},
				".xray-dialog-auto-sections .chakra-tabs__tab-panel > .chakra-stack > .chakra-box":
					{
						bg: sectionBg,
						border: "1px solid",
						borderColor,
						borderRadius: "6px",
						p: { base: 3, md: 3 },
					},
				".xray-dialog-auto-sections .chakra-tabs__tab-panel > .chakra-stack > .chakra-box .chakra-form-control":
					{
						display: "block",
						minW: 0,
					},
				".xray-dialog-auto-sections .chakra-tabs__tab-panel > .chakra-stack > .chakra-box .chakra-form-control > .chakra-form__helper-text, .xray-dialog-auto-sections .chakra-tabs__tab-panel > .chakra-stack > .chakra-box .chakra-form-control > .chakra-form__error-message":
					{
						gridColumn: "auto",
					},
				".xray-dialog-auto-sections .chakra-tabs__tab-panel > .chakra-stack > .chakra-box > .chakra-text:first-of-type":
					{
						fontSize: "sm",
						fontWeight: "semibold",
						mb: 3,
					},
				"@media (max-width: 30em)": {
					"input, select, textarea": {
						fontSize: "16px",
					},
					"input, select": {
						minH: "42px",
					},
					".chakra-button": {
						minH: "40px",
					},
					".chakra-tabs__tab": {
						minH: "38px",
						px: 3,
					},
					".xray-dialog-section": {
						p: 3,
					},
					".chakra-modal__footer": {
						position: "sticky",
						bottom: 0,
						zIndex: 1,
						boxShadow: "0 -14px 28px rgba(0, 0, 0, 0.22)",
						paddingBottom: "var(--rb-dialog-safe-bottom)",
					},
				},
				...sx,
			}}
			{...props}
		>
			{children}
		</ModalContent>
	);
};

export const XrayModalHeader: FC<
	ModalHeaderProps & { subtitle?: ReactNode }
> = ({ children, subtitle, ...props }) => (
	<ModalHeader px={{ base: 4, md: 5 }} py={3} {...props}>
		<Text fontSize="md" fontWeight="semibold">
			{children}
		</Text>
		{subtitle && (
			<Text mt={1} fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
				{subtitle}
			</Text>
		)}
	</ModalHeader>
);

export const XrayModalBody: FC<ModalBodyProps> = ({ children, ...props }) => (
	<ModalBody px={{ base: 4, md: 5 }} py={4} {...props}>
		{children}
	</ModalBody>
);

export const XrayModalFooter: FC<ModalFooterProps> = ({
	children,
	...props
}) => (
	<ModalFooter px={{ base: 4, md: 5 }} py={3} gap={2} {...props}>
		{children}
	</ModalFooter>
);

export const XrayDialogSection: FC<
	BoxProps & { title?: ReactNode; description?: ReactNode }
> = ({ title, description, children, className, ...props }) => (
	<Box
		className={["xray-dialog-section", className].filter(Boolean).join(" ")}
		{...props}
	>
		{title && (
			<Box mb={3}>
				<Text fontSize="sm" fontWeight="semibold">
					{title}
				</Text>
				{description && (
					<Text
						mt={1}
						fontSize="xs"
						color="gray.500"
						_dark={{ color: "gray.400" }}
					>
						{description}
					</Text>
				)}
			</Box>
		)}
		{children}
	</Box>
);
