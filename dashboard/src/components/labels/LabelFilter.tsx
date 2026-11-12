import { PanelSelect } from "components/common/PanelSelect";
import { Checkbox } from "components/ui/checkbox";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
	type GroupEntityType,
	NO_GROUP_FILTER,
	useGroups,
	useTags,
} from "service/labels";
import { TagsSelect } from "./TagsSelect";

export type LabelFilterValue = {
	groups: string[];
	tags: string[];
	tagMatchAll: boolean;
};

export const EMPTY_LABEL_FILTER: LabelFilterValue = {
	groups: [],
	tags: [],
	tagMatchAll: false,
};

export const labelFilterCount = (value: LabelFilterValue) =>
	value.groups.length + value.tags.length;

type LabelFilterProps = {
	type: "user" | "admin" | "host" | "inbound" | "node";
	value: LabelFilterValue;
	onChange: (value: LabelFilterValue) => void;
	showGroups?: boolean;
	showTags?: boolean;
};

export const LabelFilter: FC<LabelFilterProps> = ({
	type,
	value,
	onChange,
	showGroups = type === "user" || type === "admin",
	showTags = true,
}) => {
	const { t } = useTranslation();
	const groupType = (type === "admin" ? "admin" : "user") as GroupEntityType;
	const { data: groups = [] } = useGroups(groupType, showGroups);
	const { data: tags = [] } = useTags(type, showTags);
	const groupOptions = [
		{ value: NO_GROUP_FILTER, label: t("groups.noGroup") },
		...groups.map((group) => ({ value: String(group.id), label: group.name })),
	];
	return (
		<div className="flex flex-col gap-3">
			{showGroups && (
				<div>
					<p className="mb-1 text-[0.875rem] font-semibold">
						{t("groups.filterLabel")}
					</p>
					<PanelSelect
						mode="multiple"
						portalled={false}
						options={groupOptions}
						value={value.groups}
						placeholder={t("groups.filterAll")}
						onValueChange={(next) =>
							onChange({
								...value,
								groups: Array.isArray(next) ? next : [next],
							})
						}
					/>
				</div>
			)}
			{showTags && (
				<div>
					<p className="mb-1 text-[0.875rem] font-semibold">
						{t("tags.filterLabel")}
					</p>
					<TagsSelect
						allowCustom={false}
						value={value.tags}
						options={tags.map((item) => item.tag)}
						placeholder={t("tags.filterAll")}
						onChange={(next) => onChange({ ...value, tags: next })}
					/>
					{value.tags.length > 1 && (
						<label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
							<Checkbox
								checked={value.tagMatchAll}
								onCheckedChange={(checked) =>
									onChange({ ...value, tagMatchAll: checked === true })
								}
							/>
							<span>{t("tags.matchAll")}</span>
						</label>
					)}
				</div>
			)}
		</div>
	);
};

export const matchesTagFilter = (
	tags: string[] | undefined,
	value: LabelFilterValue,
) => {
	if (!value.tags.length) return true;
	const own = new Set(tags ?? []);
	return value.tagMatchAll
		? value.tags.every((tag) => own.has(tag))
		: value.tags.some((tag) => own.has(tag));
};
