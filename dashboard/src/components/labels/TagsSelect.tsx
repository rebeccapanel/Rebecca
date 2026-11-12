import { PanelSelect } from "components/common/PanelSelect";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { normalizeTags } from "service/labels";

type TagsSelectProps = {
	value: string[];
	onChange: (tags: string[]) => void;
	options?: string[];
	allowCustom?: boolean;
	disabled?: boolean;
	placeholder?: string;
	portalled?: boolean;
};

export const TagsSelect: FC<TagsSelectProps> = ({
	value,
	onChange,
	options = [],
	allowCustom = true,
	disabled,
	placeholder,
	portalled = false,
}) => {
	const { t } = useTranslation();
	return (
		<PanelSelect
			mode="multiple"
			allowCustom={allowCustom}
			disabled={disabled}
			portalled={portalled}
			options={options}
			value={value}
			placeholder={placeholder ?? t("tags.placeholder")}
			emptyText={t("tags.empty")}
			onValueChange={(next) =>
				onChange(normalizeTags(Array.isArray(next) ? next : [next]))
			}
		/>
	);
};
