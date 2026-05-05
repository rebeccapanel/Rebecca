import {
	NumberDecrementStepper,
	NumberIncrementStepper,
	NumberInput,
	NumberInputField,
	type NumberInputFieldProps,
	type NumberInputProps,
	NumberInputStepper,
} from "@chakra-ui/react";
import type { Ref } from "react";

type NumericInputProps = Omit<NumberInputProps, "onChange"> & {
	fieldProps?: NumberInputFieldProps;
	fieldRef?: Ref<HTMLInputElement>;
	onChange?: (valueAsString: string, valueAsNumber: number) => void;
};

export const NumericInput = ({
	fieldProps,
	fieldRef,
	min = 0,
	step = 1,
	defaultValue = 0,
	...props
}: NumericInputProps) => {
	const fieldPaddingRight = fieldProps?.pr ?? fieldProps?.paddingRight ?? "2rem";

	return (
		<NumberInput
			keepWithinRange
			min={min}
			step={step}
			defaultValue={props.value === undefined ? defaultValue : undefined}
			role="group"
			{...props}
		>
			<NumberInputField
				ref={fieldRef}
				inputMode="decimal"
				{...fieldProps}
				pr={fieldPaddingRight}
			/>
			<NumberInputStepper
				opacity={0}
				pointerEvents="none"
				transition="opacity 0.15s ease"
				_groupHover={{ opacity: 1, pointerEvents: "auto" }}
				_groupFocusWithin={{ opacity: 1, pointerEvents: "auto" }}
			>
				<NumberIncrementStepper />
				<NumberDecrementStepper />
			</NumberInputStepper>
		</NumberInput>
	);
};
