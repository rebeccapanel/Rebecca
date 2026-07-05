import type { FC, ReactNode } from "react";
import {
	PanelSelect,
	type PanelSelectOption,
	splitPanelSelectText,
} from "./PanelSelect";

export type MultiValueAutocompleteOption = PanelSelectOption;

type MultiValueAutocompleteProps = {
	emptyText?: string;
	options?: MultiValueAutocompleteOption[];
	placeholder?: string;
	rightElement?: ReactNode;
	value: string;
	onChange: (value: string) => void;
};

export const splitMultiValueText = splitPanelSelectText;

export const MultiValueAutocomplete: FC<MultiValueAutocompleteProps> = ({
	emptyText,
	options = [],
	placeholder,
	rightElement,
	value,
	onChange,
}) => (
	<PanelSelect
		mode="multiple"
		allowCustom
		emptyText={emptyText}
		options={options}
		placeholder={placeholder}
		rightElement={rightElement}
		value={value}
		onValueChange={(nextValue) =>
			onChange(Array.isArray(nextValue) ? nextValue.join(", ") : nextValue)
		}
	/>
);
