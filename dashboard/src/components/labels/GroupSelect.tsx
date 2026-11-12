import { PanelSelect } from "components/common/PanelSelect";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { type GroupEntityType, useGroups } from "service/labels";

type GroupSelectProps = {
	type: GroupEntityType;
	value: number | null;
	onChange: (groupId: number | null) => void;
	disabled?: boolean;
	portalled?: boolean;
};

export const GroupSelect: FC<GroupSelectProps> = ({
	type,
	value,
	onChange,
	disabled,
	portalled = false,
}) => {
	const { t } = useTranslation();
	const { data: groups = [] } = useGroups(type);
	const options = [
		{ value: "", label: t("groups.noGroup") },
		...groups.map((group) => ({ value: String(group.id), label: group.name })),
	];
	return (
		<PanelSelect
			disabled={disabled}
			portalled={portalled}
			options={options}
			value={value === null ? "" : String(value)}
			onValueChange={(next) => {
				const raw = Array.isArray(next) ? next[0] : next;
				onChange(raw ? Number(raw) : null);
			}}
		/>
	);
};
