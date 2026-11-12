import { Input } from "components/ui/input";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, type ChangeEvent } from "react";
import { NumericInput } from "./NumericInput";

export type PanelInputProps = Omit<ComponentPropsWithoutRef<"input">, "size"> & {
	size?: "xs" | "sm" | "md" | "lg";
	disabled?: boolean;
};

export const PanelInput = forwardRef<HTMLInputElement, PanelInputProps>(
	(
		{
			type,
			onChange,
			value,
			defaultValue,
			min,
			max,
			step,
			size,
			disabled: isDisabled,
			...props
		},
		ref,
	) => {
		if (type !== "number") {
			return (
				<Input ref={ref} type={type} onChange={onChange} value={value} defaultValue={defaultValue} min={min} max={max} step={step} disabled={isDisabled} {...props} />
			);
		}

		const numericMin =
			typeof min === "number" ? min : min === undefined ? 0 : Number(min);
		const numericMax =
			typeof max === "number" ? max : max === undefined ? undefined : Number(max);
		const numericStep =
			typeof step === "number" ? step : step === undefined ? 1 : Number(step);

		return (
			<NumericInput
				value={value as string | number | undefined}
				defaultValue={defaultValue as string | number | undefined}
				min={numericMin}
				max={numericMax}
				step={numericStep}
				size={size}
				disabled={isDisabled}
				fieldRef={ref}
				fieldProps={{
					...props,
					type: undefined,
					onChange: undefined,
				}}
				onChange={(valueAsString, valueAsNumber) => {
					onChange?.({
						target: {
							...props,
							value: valueAsString,
							valueAsNumber,
							name: props.name,
						},
					} as unknown as ChangeEvent<HTMLInputElement>);
				}}
			/>
		);
	},
);
