import type { ReactNode } from "react";
import { PanelSelect, type PanelSelectOption } from "./PanelSelect";

export type SearchableTagSelectOption =
	| string
	| {
			disabled?: boolean;
			label?: string;
			title?: string;
			value: string;
	  };

type SearchableTagSelectProps = {
	emptyText?: string;
	disabled?: boolean;
	mode?: "single" | "multiple";
	onChange: (value: string | string[]) => void;
	options: SearchableTagSelectOption[];
	placeholder: string;
	rightElement?: ReactNode;
	searchPlaceholder?: string;
	size?: "sm" | "md";
	value: string | string[];
	width?: string;
	className?: string;
};

const normalizeOption = (
	option: SearchableTagSelectOption,
): PanelSelectOption => {
	if (typeof option === "string") {
		return {
			label: option,
			title: option,
			value: option,
		};
	}
	return {
		disabled: option.disabled,
		label: option.label || option.title || option.value,
		title: option.title || option.label || option.value,
		value: option.value,
	};
};

export const SearchableTagSelect = ({
	emptyText = "No options found",
	disabled: isDisabled,
	mode = "single",
	onChange,
	options,
	placeholder,
	rightElement,
	searchPlaceholder = "Search",
	size = "sm",
	value,
	width,
	className,
}: SearchableTagSelectProps) => (
	<PanelSelect
		mode={mode}
		value={value}
		options={options.map(normalizeOption)}
		placeholder={placeholder}
		rightElement={rightElement}
		searchPlaceholder={searchPlaceholder}
		emptyText={emptyText}
		disabled={isDisabled}
		size={size}
		className={className} style={{ width }}
		onValueChange={onChange}
	/>
);
