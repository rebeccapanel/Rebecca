import {
	AlertDialog,
	AlertDialogBody,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	Box,
	Button,
	chakra,
	Flex,
	Text,
	useColorModeValue,
	useDisclosure,
} from "@chakra-ui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
	cloneElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

const WarningIcon = chakra(ExclamationTriangleIcon, {
	baseStyle: { w: 6, h: 6 },
});

export type ConfirmDialogProps = {
	isOpen: boolean;
	title: ReactNode;
	description: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	colorScheme?: string;
	isLoading?: boolean;
	isConfirmDisabled?: boolean;
	onClose: () => void;
	onConfirm: () => void | Promise<void>;
};

export const ConfirmDialog = ({
	isOpen,
	title,
	description,
	confirmLabel,
	cancelLabel,
	colorScheme = "primary",
	isLoading = false,
	isConfirmDisabled = false,
	onClose,
	onConfirm,
}: ConfirmDialogProps) => {
	const { t } = useTranslation();
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const dialogBg = useColorModeValue("surface.light", "surface.dark");
	const dialogBorder = useColorModeValue("light-border", "gray.700");
	const mutedText = useColorModeValue("gray.600", "gray.300");
	const iconBg = useColorModeValue(`${colorScheme}.50`, `${colorScheme}.900`);
	const iconColor = useColorModeValue(
		`${colorScheme}.600`,
		`${colorScheme}.300`,
	);

	return (
		<AlertDialog
			isOpen={isOpen}
			leastDestructiveRef={cancelRef}
			onClose={onClose}
			isCentered
		>
			<AlertDialogOverlay bg="blackAlpha.500" backdropFilter="blur(12px)">
				<AlertDialogContent
					className="rb-confirm-dialog-content"
					bg={dialogBg}
					borderWidth="1px"
					borderColor={dialogBorder}
					borderRadius="2xl"
					boxShadow="2xl"
					overflow="hidden"
					mx={{ base: 4, sm: 0 }}
					w={{ base: "calc(100vw - 32px)", sm: "auto" }}
					maxW={{ base: "calc(100vw - 32px)", sm: "520px" }}
					px={{ base: 4, sm: 4.5 }}
					py={{ base: 3.5, sm: 4 }}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || isLoading || isConfirmDisabled) {
							return;
						}
						event.preventDefault();
						void onConfirm();
					}}
				>
					<Flex align="flex-start" gap={2.5}>
						<Flex
							align="center"
							justify="center"
							flex="0 0 auto"
							w={9}
							h={9}
							borderRadius="full"
							bg={iconBg}
							color={iconColor}
						>
							<WarningIcon />
						</Flex>
						<Box flex="1" minW={0}>
							<AlertDialogHeader
								p={0}
								fontSize="lg"
								fontWeight="800"
								lineHeight="short"
								mb={0.5}
							>
								{title}
							</AlertDialogHeader>
							<AlertDialogBody p={0} mt={1.5}>
								{typeof description === "string" ? (
									<Text color={mutedText} fontSize="sm" lineHeight="1.45">
										{description}
									</Text>
								) : (
									description
								)}
							</AlertDialogBody>
						</Box>
					</Flex>
					<AlertDialogFooter
						p={0}
						pt={{ base: 1.5, sm: 2 }}
						gap={1.5}
						flexWrap="wrap"
						justifyContent="flex-end"
						className="rb-confirm-dialog-actions"
					>
						<Button
							ref={cancelRef}
							onClick={onClose}
							isDisabled={isLoading}
							size="sm"
							minW="76px"
							h="34px"
							minH="34px"
							px={3}
							fontSize="sm"
						>
							{cancelLabel ?? t("cancel")}
						</Button>
						<Button
							colorScheme={colorScheme}
							onClick={onConfirm}
							isLoading={isLoading}
							isDisabled={isConfirmDisabled}
							size="sm"
							minW="76px"
							h="34px"
							minH="34px"
							px={3}
							fontSize="sm"
						>
							{confirmLabel ?? t("confirm")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialogOverlay>
		</AlertDialog>
	);
};

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, "");

export type DeleteConfirmDialogProps = {
	children: ReactElement;
	description?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	isLoading?: boolean;
	isDisabled?: boolean;
	onConfirm: () => void | Promise<void>;
	onCancel?: () => void;
};

export const DeleteConfirmDialog = ({
	children,
	description,
	confirmLabel,
	cancelLabel,
	isLoading,
	isDisabled,
	onConfirm,
	onCancel,
}: DeleteConfirmDialogProps) => {
	const { t } = useTranslation();
	const { isOpen, onClose, onOpen } = useDisclosure();
	const [isConfirming, setIsConfirming] = useState(false);
	const busy = Boolean(isLoading) || isConfirming;
	const confirmMessage =
		typeof description === "string"
			? stripHtmlTags(description)
			: (description ?? t("common.confirmDelete"));

	const handleClose = () => {
		if (busy) return;
		onCancel?.();
		onClose();
	};
	const handleConfirm = async () => {
		setIsConfirming(true);
		try {
			await onConfirm();
			onClose();
		} finally {
			setIsConfirming(false);
		}
	};
	const childProps = children.props as {
		onClick?: (event: MouseEvent<HTMLElement>) => void;
		onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
	};
	const trigger = cloneElement(children, {
		onClickCapture: (event: MouseEvent<HTMLElement>) => {
			childProps.onClickCapture?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			event.stopPropagation();
			if (!isDisabled && !busy) onOpen();
		},
		onClick: (event: MouseEvent<HTMLElement>) => {
			childProps.onClick?.(event);
			event.stopPropagation();
		},
	} as Partial<typeof children.props>);

	return (
		<>
			{trigger}
			<ConfirmDialog
				isOpen={isOpen}
				onClose={handleClose}
				onConfirm={handleConfirm}
				title={t("common.confirmAction")}
				description={confirmMessage}
				confirmLabel={confirmLabel ?? t("delete")}
				cancelLabel={cancelLabel ?? t("cancel")}
				colorScheme="red"
				isLoading={busy}
				isConfirmDisabled={Boolean(isDisabled)}
			/>
		</>
	);
};
