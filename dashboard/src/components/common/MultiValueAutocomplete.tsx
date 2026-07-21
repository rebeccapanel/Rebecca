import type { FC, ReactNode } from "react";
import {
	PanelSelect,
	type PanelSelectOption,
	splitPanelSelectText,
} from "./PanelSelect";

export type MultiValueAutocompleteOption = PanelSelectOption;

type MultiValueAutocompleteProps = {
	allowCustom?: boolean;
	emptyText?: string;
	isDisabled?: boolean;
	maxValues?: number;
	options?: MultiValueAutocompleteOption[];
	placeholder?: string;
	rightElement?: ReactNode;
	value: string;
	onChange: (value: string) => void;
};

export const splitMultiValueText = splitPanelSelectText;

export const MultiValueAutocomplete: FC<MultiValueAutocompleteProps> = ({
	allowCustom = true,
	emptyText,
	isDisabled = false,
	maxValues,
	options = [],
	placeholder,
	rightElement,
	value,
	onChange,
}) => (
	<PanelSelect
		mode="multiple"
		allowCustom={allowCustom}
		isDisabled={isDisabled}
		emptyText={emptyText}
		options={options}
		placeholder={placeholder}
		rightElement={rightElement}
		value={value}
		onValueChange={(nextValue) => {
			if (!Array.isArray(nextValue)) {
				onChange(nextValue);
				return;
			}
			const values =
				maxValues && nextValue.length > maxValues
					? nextValue.slice(-maxValues)
					: nextValue;
			onChange(values.join(", "));
		}}
	/>
);
