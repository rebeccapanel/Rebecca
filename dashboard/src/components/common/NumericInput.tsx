import { Input } from "components/ui/input";
import { cn } from "lib/cn";
import type { ComponentProps, ComponentPropsWithoutRef, Ref } from "react";

const SIZE_CLASSES = {
	xs: "h-7 text-xs",
	sm: "h-8 text-sm",
	md: "",
	lg: "h-10 text-base",
} as const;

type NumericInputProps = Omit<ComponentProps<"input">, "onChange" | "value" | "defaultValue" | "size"> & {
	size?: keyof typeof SIZE_CLASSES;
	value?: string | number;
	defaultValue?: string | number;
	fieldProps?: ComponentPropsWithoutRef<"input">;
	fieldRef?: Ref<HTMLInputElement>;
	onChange?: (valueAsString: string, valueAsNumber: number) => void;
};

export const NumericInput = ({
	fieldProps = {},
	fieldRef,
	min = 0,
	step = 1,
	defaultValue = 0,
	size = "md",
	value,
	onChange,
	className,
	...props
}: NumericInputProps) => {
	const { style: fieldStyle, className: fieldClassName, ...restFieldProps } = fieldProps;

	return (
		<Input
			ref={fieldRef}
			type="number"
			inputMode="decimal"
			min={min}
			step={step}
			value={value}
			defaultValue={value === undefined ? defaultValue : undefined}
			onChange={(event) => onChange?.(event.target.value, event.target.valueAsNumber)}
			className={cn(SIZE_CLASSES[size], className, fieldClassName)}
			style={fieldStyle}
			{...restFieldProps}
			{...props}
		/>
	);
};
