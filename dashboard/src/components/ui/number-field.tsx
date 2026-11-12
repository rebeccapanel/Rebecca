import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "lib/cn";

type NumberFieldProps = {
	id?: string;
	value: string;
	onChange: (raw: string) => void;
	step?: number;
	min?: number;
	max?: number;
	unit?: string;
	unitSlot?: ReactNode;
	placeholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	/** Which on-screen keypad a phone opens: whole numbers or decimals. */
	inputMode?: "numeric" | "decimal";
	doneLabel?: string;
};

/** A mouse notch is large; trackpads send many small deltas that only step once they add up. */
const WHEEL_THRESHOLD = 40;

/**
 * A numeric input with an optional unit and stepper buttons. The stepper buttons, the up and down arrow keys and
 * the mouse wheel (while the pointer is over the field) all change the value. An empty value means unset,
 * so stepping down keeps it empty.
 */
export const NumberField: FC<NumberFieldProps> = ({
	id,
	value,
	onChange,
	step = 1,
	min = 0,
	max,
	unit,
	unitSlot,
	placeholder,
	disabled = false,
	invalid = false,
	inputMode = "decimal",
	doneLabel,
}) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const [focused, setFocused] = useState(false);
	const wheelDelta = useRef(0);
	const latest = useRef({ value, onChange, step, min, max, disabled });
	latest.current = { value, onChange, step, min, max, disabled };

	const stepBy = (direction: 1 | -1) => {
		const current = latest.current;
		if (current.disabled) return;
		const parsed = Number.parseFloat(current.value);
		if (!current.value.trim() || Number.isNaN(parsed)) {
			if (direction > 0) current.onChange(String(Math.max(current.min, current.step)));
			return;
		}
		let next = Math.round((parsed + direction * current.step) * 100) / 100;
		if (next < current.min) next = current.min;
		if (current.max !== undefined && next > current.max) next = current.max;
		current.onChange(String(next));
	};

	useEffect(() => {
		const element = inputRef.current;
		if (!element) return undefined;
		const onWheel = (event: WheelEvent) => {
			if (latest.current.disabled) return;
			event.preventDefault();
			element.focus({ preventScroll: true });
			wheelDelta.current += event.deltaY;
			if (Math.abs(wheelDelta.current) < WHEEL_THRESHOLD) return;
			stepBy(wheelDelta.current < 0 ? 1 : -1);
			wheelDelta.current = 0;
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, []);

	return (
		<div
			className={cn(
				"flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
				invalid && "border-destructive",
				disabled && "opacity-50",
			)}
		>
			<input
				ref={inputRef}
				id={id}
				dir="ltr"
				inputMode={inputMode}
				value={value}
				placeholder={placeholder}
				disabled={disabled}
				aria-invalid={invalid || undefined}
				onChange={(event) => onChange(event.target.value)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					stepBy(event.key === "ArrowUp" ? 1 : -1);
				}}
				className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
			/>
			{doneLabel && focused && !disabled ? (
				<button
					type="button"
					tabIndex={-1}
					aria-label={doneLabel}
					title={doneLabel}
					onPointerDown={(event) => event.preventDefault()}
					onClick={() => inputRef.current?.blur()}
					className="flex w-8 shrink-0 items-center justify-center text-primary transition-colors hover:bg-whiteAlpha-100"
				>
					<Check className="size-4" />
				</button>
			) : null}
			{unitSlot ?? (unit ? (
				<span className="inline-flex shrink-0 items-center border-s border-input bg-muted px-2.5 text-xs text-muted-foreground select-none">
					{unit}
				</span>
			) : null)}
			<div className="flex w-6 shrink-0 flex-col border-s border-input">
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					disabled={disabled}
					onClick={() => stepBy(1)}
					className="flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-whiteAlpha-100 hover:text-panel-text disabled:pointer-events-none"
				>
					<ChevronUp className="size-3" />
				</button>
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					disabled={disabled}
					onClick={() => stepBy(-1)}
					className="flex flex-1 items-center justify-center border-t border-input text-muted-foreground transition-colors hover:bg-whiteAlpha-100 hover:text-panel-text disabled:pointer-events-none"
				>
					<ChevronDown className="size-3" />
				</button>
			</div>
		</div>
	);
};
