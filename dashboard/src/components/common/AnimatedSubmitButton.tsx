import type { ButtonProps } from "components/ui/button";
import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Check, LoaderCircle, X } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { FC, ReactNode } from "react";

export type AnimatedSubmitStatus = "idle" | "loading" | "success" | "error";

type AnimatedSubmitButtonProps = { h?: string; px?: number | string } & Omit<ButtonProps, "children" | "isLoading"> & {
	containerProps?: ComponentPropsWithoutRef<"div">;
	compactWidth?: number;
	idleContent: ReactNode;
	status: AnimatedSubmitStatus;
	successContent?: ReactNode;
	successLabel?: ReactNode;
	successWidth?: number;
};

const SuccessIcon = withClass(Check, "w-4 h-4 [stroke-width:2.4px]");

const ErrorIcon = withClass(X, "w-5 h-5 [stroke-width:2.4px]");

const renderTextContent = (content: ReactNode) =>
	typeof content === "string" ? (
		<span className="font-bold whitespace-nowrap">
			{content}
		</span>
	) : (
		content
	);

export const AnimatedSubmitButton: FC<AnimatedSubmitButtonProps> = ({
	compactWidth = 44,
	containerProps,
	h = "44px",
	idleContent,
	disabled: isDisabled,
	px,
	status,
	successContent,
	successLabel = "Done",
	successWidth = 154,
	...buttonProps
}) => {
	const reduceMotion = useReducedMotion();
	const isFeedbackState = status !== "idle";
	const isCompact = status === "loading" || status === "error";
	const targetWidth = status === "success" ? successWidth : isCompact ? compactWidth : "100%";
	const buttonBg =
		status === "success" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-primary-500";
	const buttonHoverBg =
		status === "success" ? "hover:bg-green-500" : status === "error" ? "hover:bg-red-500" : "hover:bg-primary-600";

	const content = (() => {
		if (status === "loading") {
			return (
				<LoaderCircle
					aria-hidden="true"
					className="size-5 animate-spin text-white"
				/>
			);
		}
		if (status === "success") {
			return (
				successContent ?? (
					<div className="flex flex-row items-center gap-2">
						<SuccessIcon className="text-white" />
						<span className="font-extrabold whitespace-nowrap">
							{successLabel}
						</span>
					</div>
				)
			);
		}
		if (status === "error") {
			return <ErrorIcon className="text-white" />;
		}
		return renderTextContent(idleContent);
	})();

	return (
		<div {...containerProps} className="flex justify-center w-full">
			<motion.div
				initial={false}
				style={{ display: "flex", justifyContent: "center", width: targetWidth }}
			>
				<Button aria-disabled={Boolean(isDisabled || isFeedbackState)} disabled={Boolean(isDisabled)} {...buttonProps} style={{ height: h, minHeight: h, paddingInline: px === undefined ? (status === "success" ? "1rem" : isCompact ? "0" : "2rem") : typeof px === "number" ? `${px * 0.25}rem` : px }} className={cn(cn("text-white overflow-hidden w-full disabled:cursor-not-allowed disabled:shadow-none", buttonBg, status === "idle" ? "rounded-[8px]" : "rounded-[999px]", isDisabled ? "cursor-not-allowed" : "cursor-pointer", isDisabled && status === "idle" ? "opacity-65" : "opacity-100", isFeedbackState ? "pointer-events-none" : "pointer-events-auto", buttonHoverBg, status === "idle" ? "active:[transform:scale(0.97)]" : "active:[transform:none]", isDisabled && status === "idle" ? "disabled:opacity-65" : "disabled:opacity-100"))}>
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
		</div>
	);
};
