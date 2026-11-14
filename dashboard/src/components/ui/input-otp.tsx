import {
	HiddenInput,
	Input as OTPInputSlot,
	Root as OTPRoot,
} from "@radix-ui/react-one-time-password-field";
import { cn } from "lib/cn";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

export interface InputOTPProps
	extends ComponentPropsWithoutRef<typeof OTPRoot> {
	containerClassName?: string;
}

export const InputOTP = forwardRef<HTMLDivElement, InputOTPProps>(
	function InputOTP({ className, containerClassName, ...props }, ref) {
		return (
			<div
				data-input-otp-container="true"
				dir="ltr"
				className={cn(
					"flex w-full items-center justify-center select-none",
					containerClassName,
				)}
			>
				<OTPRoot
					ref={ref}
					className={cn(
						"flex items-center gap-2 [unicode-bidi:isolate]",
						className,
					)}
					{...props}
				/>
			</div>
		);
	},
);

export interface InputOTPSlotProps
	extends ComponentPropsWithoutRef<typeof OTPInputSlot> {
	index: number;
}

export const InputOTPSlot = forwardRef<HTMLInputElement, InputOTPSlotProps>(
	function InputOTPSlot({ className, index, ...props }, ref) {
		return (
			<OTPInputSlot
				ref={ref}
				index={index}
				className={cn(
					"size-11 rounded-[14px] border border-panel-border! bg-panel-elevated/60 text-center font-mono text-[18px] font-bold text-panel-text shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_0_rgba(255,255,255,0.06)] outline-none transition-[border-color,box-shadow,transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [touch-action:manipulation] placeholder:text-panel-text-muted/40",
					"focus-visible:border-panel-accent! focus-visible:bg-panel-elevated focus-visible:ring-2 focus-visible:ring-panel-accent/40 active:scale-[0.98]",
					"aria-invalid:border-red-500! aria-invalid:text-red-500 aria-invalid:focus-visible:ring-red-500/30",
					"disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		);
	},
);

export const InputOTPSeparator = forwardRef<
	HTMLSpanElement,
	ComponentPropsWithoutRef<"span">
>(function InputOTPSeparator({ className, ...props }, ref) {
	return (
		<span
			ref={ref}
			aria-hidden="true"
			className={cn("mx-1 h-1 w-2 rounded-full bg-panel-border-strong/60", className)}
			{...props}
		/>
	);
});

export const InputOTPHiddenInput = HiddenInput;
