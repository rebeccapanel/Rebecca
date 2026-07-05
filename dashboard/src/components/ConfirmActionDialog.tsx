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
} from "@chakra-ui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { useRef } from "react";

const WarningIcon = chakra(ExclamationTriangleIcon, {
	baseStyle: {
		w: 6,
		h: 6,
	},
});

type ConfirmActionDialogProps = {
	isOpen: boolean;
	title: string;
	message: ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	colorScheme?: string;
	isLoading?: boolean;
	isConfirmDisabled?: boolean;
	onClose: () => void;
	onConfirm: () => void;
};

export const ConfirmActionDialog = ({
	isOpen,
	title,
	message,
	confirmLabel,
	cancelLabel,
	colorScheme = "primary",
	isLoading = false,
	isConfirmDisabled = false,
	onClose,
	onConfirm,
}: ConfirmActionDialogProps) => {
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
						onConfirm();
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
								{typeof message === "string" ? (
									<Text color={mutedText} fontSize="sm" lineHeight="1.45">
										{message}
									</Text>
								) : (
									message
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
							{cancelLabel}
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
							{confirmLabel}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialogOverlay>
		</AlertDialog>
	);
};

export default ConfirmActionDialog;
