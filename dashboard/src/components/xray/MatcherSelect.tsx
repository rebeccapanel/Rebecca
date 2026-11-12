import { type FC, useMemo, useState } from "react";
import {
	PanelSelect,
	type PanelSelectOption,
} from "components/common/PanelSelect";
import {
	isMatcherPrefix,
	type MatcherKind,
	matcherOptions,
} from "utils/xrayRouting";

type MatcherSelectProps = {
	value: string;
	kind: MatcherKind;
	placeholder?: string;
	onChange: (value: string) => void;
};

export const MatcherSelect: FC<MatcherSelectProps> = ({
	value,
	kind,
	placeholder,
	onChange,
}) => {
	const [text, setText] = useState("");
	const options = useMemo<PanelSelectOption[]>(
		() =>
			matcherOptions(kind).map((option) => ({
				value: option.value,
				title: option.hint,
			})),
		[kind],
	);

	return (
		<PanelSelect
			mode="multiple"
			allowCustom
			options={options}
			value={value}
			placeholder={placeholder}
			inputValue={text}
			onInputValueChange={setText}
			interceptOption={(optionValue) => {
				if (!isMatcherPrefix(optionValue)) return false;
				setText(optionValue);
				return true;
			}}
			onValueChange={(next) => {
				if (!Array.isArray(next)) {
					onChange(next);
					return;
				}
				onChange(next.filter((item) => !isMatcherPrefix(item)).join(", "));
			}}
		/>
	);
};
