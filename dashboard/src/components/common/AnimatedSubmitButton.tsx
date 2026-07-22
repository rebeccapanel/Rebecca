import {
	Box,
	Button,
	chakra,
	HStack,
	Text,
	type BoxProps,
	type ButtonProps,
	usePrefersReducedMotion,
} from "@chakra-ui/react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import type { FC, ReactNode } from "react";

export type AnimatedSubmitStatus = "idle" | "loading" | "success" | "error";

type AnimatedSubmitButtonProps = Omit<ButtonProps, "children" | "isLoading"> & {
	containerProps?: BoxProps;
	compactWidth?: number;
	idleContent: ReactNode;
	status: AnimatedSubmitStatus;
	successContent?: ReactNode;
	successLabel?: ReactNode;
	successWidth?: number;
};

const SuccessIcon = chakra(CheckIcon, {
	baseStyle: { w: 4, h: 4, strokeWidth: "2.4px" },
});

const ErrorIcon = chakra(XMarkIcon, {
	baseStyle: { w: 5, h: 5, strokeWidth: "2.4px" },
});

const renderTextContent = (content: ReactNode) =>
	typeof content === "string" ? (
		<Text as="span" fontWeight="700" whiteSpace="nowrap">
			{content}
		</Text>
	) : (
		content
	);

export const AnimatedSubmitButton: FC<AnimatedSubmitButtonProps> = ({
	compactWidth = 44,
	containerProps,
	h = "44px",
	idleContent,
	isDisabled,
	px,
	status,
	successContent,
	successLabel = "Done",
	successWidth = 154,
	...buttonProps
}) => {
	const reduceMotion = usePrefersReducedMotion();
	const isFeedbackState = status !== "idle";
	const isCompact = status === "loading" || status === "error";
	const targetWidth = status === "success" ? successWidth : isCompact ? compactWidth : "100%";
	const buttonBg =
		status === "success"
			? "green.500"
			: status === "error"
				? "red.500"
				: "primary.500";
	const buttonHoverBg =
		status === "success"
			? "green.500"
			: status === "error"
				? "red.500"
				: "primary.600";

	const content = (() => {
		if (status === "loading") {
			return (
				<Box
					aria-hidden
					border="2px solid"
					borderColor="whiteAlpha.600"
					borderTopColor="white"
					className="animate-spin"
					h="20px"
					rounded="full"
					w="20px"
				/>
			);
		}
		if (status === "success") {
			return (
				successContent ?? (
					<HStack spacing={2}>
						<SuccessIcon color="white" />
						<Text as="span" fontWeight="800" whiteSpace="nowrap">
							{successLabel}
						</Text>
					</HStack>
				)
			);
		}
		if (status === "error") {
			return <ErrorIcon color="white" />;
		}
		return renderTextContent(idleContent);
	})();

	return (
		<Box
			display="flex"
			justifyContent="center"
			w="full"
			{...containerProps}
		>
			<motion.div
				initial={false}
				style={{ display: "flex", justifyContent: "center", width: targetWidth }}
			>
				<Button
					aria-disabled={Boolean(isDisabled || isFeedbackState)}
					bg={buttonBg}
					borderRadius={status === "idle" ? "8px" : "999px"}
					color="white"
					cursor={isDisabled ? "not-allowed" : "pointer"}
					h={h}
					isDisabled={Boolean(isDisabled)}
					minH={h}
					opacity={isDisabled && status === "idle" ? 0.65 : 1}
					overflow="hidden"
					pointerEvents={isFeedbackState ? "none" : "auto"}
					px={px ?? (status === "success" ? 4 : isCompact ? 0 : 8)}
					w="full"
					_hover={{ bg: buttonHoverBg }}
					_active={{
						transform: status === "idle" ? "scale(0.97)" : "none",
					}}
					_disabled={{
						opacity: isDisabled && status === "idle" ? 0.65 : 1,
						cursor: "not-allowed",
						boxShadow: "none",
					}}
					{...buttonProps}
				>
					<AnimatePresence initial={false} mode="wait">
						<motion.span
							animate={{
								filter: "blur(0px)",
								opacity: 1,
								transform: "scale(1)",
							}}
							exit={{
								filter: reduceMotion ? "blur(0px)" : "blur(1.5px)",
								opacity: 0,
								transform: reduceMotion ? "scale(1)" : "scale(0.97)",
							}}
							initial={{
								filter: reduceMotion ? "blur(0px)" : "blur(1.5px)",
								opacity: 0,
								transform: reduceMotion ? "scale(1)" : "scale(0.97)",
							}}
							key={status}
							style={{
								alignItems: "center",
								display: "inline-flex",
								justifyContent: "center",
							}}
							transition={{
								duration: reduceMotion ? 0.1 : 0.16,
								ease: [0.23, 1, 0.32, 1],
							}}
						>
							{content}
						</motion.span>
					</AnimatePresence>
				</Button>
			</motion.div>
		</Box>
	);
};
