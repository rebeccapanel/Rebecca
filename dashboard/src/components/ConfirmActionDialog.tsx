import {
	AlertDialog,
	AlertDialogBody,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	Button,
	useColorModeValue,
} from "@chakra-ui/react";
import { useRef } from "react";

type ConfirmActionDialogProps = {
	isOpen: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	colorScheme?: string;
	isLoading?: boolean;
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
	onClose,
	onConfirm,
}: ConfirmActionDialogProps) => {
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const dialogBg = useColorModeValue("surface.light", "surface.dark");
	const dialogBorder = useColorModeValue("light-border", "gray.700");

	return (
		<AlertDialog
			isOpen={isOpen}
			leastDestructiveRef={cancelRef}
			onClose={onClose}
			isCentered
		>
			<AlertDialogOverlay bg="blackAlpha.300" backdropFilter="blur(10px)">
				<AlertDialogContent
					bg={dialogBg}
					borderWidth="1px"
					borderColor={dialogBorder}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || isLoading) {
							return;
						}
						event.preventDefault();
						onConfirm();
					}}
				>
					<AlertDialogHeader fontSize="lg" fontWeight="bold">
						{title}
					</AlertDialogHeader>
					<AlertDialogBody>{message}</AlertDialogBody>
					<AlertDialogFooter>
						<Button ref={cancelRef} onClick={onClose} isDisabled={isLoading}>
							{cancelLabel}
						</Button>
						<Button
							colorScheme={colorScheme}
							onClick={onConfirm}
							ml={3}
							isLoading={isLoading}
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
