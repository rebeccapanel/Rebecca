import { toast } from "components/ui/sonner";
import { Button } from "components/ui/button";
import { Spinner } from "components/ui/spinner";
import { AppDialog } from "components/dialogs/AppDialog";
import { FormField } from "components/ui/form-field";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type EntityLabels,
	type GroupEntityType,
	type LabelEntityType,
	saveLabels,
	useInvalidateLabels,
	useTags,
} from "service/labels";
import { getAPIErrorMessage } from "service/http";
import { GroupSelect } from "./GroupSelect";
import { TagsSelect } from "./TagsSelect";

type LabelsDialogProps = {
	open: boolean;
	onClose: () => void;
	type: LabelEntityType;
	entityKey: string | number;
	entityName: string;
	current?: EntityLabels | null;
	onSaved?: () => void;
};

export const LabelsDialog: FC<LabelsDialogProps> = ({
	open,
	onClose,
	type,
	entityKey,
	entityName,
	current,
	onSaved,
}) => {
	const { t } = useTranslation();
	const invalidateLabels = useInvalidateLabels();
	const { data: knownTags = [] } = useTags(type, open);
	const supportsGroups = type === "user" || type === "admin";
	const [groupId, setGroupId] = useState<number | null>(null);
	const [tags, setTags] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setGroupId(current?.group?.id ?? null);
		setTags(current?.tags ?? []);
	}, [open, current]);

	const submit = async () => {
		setSaving(true);
		try {
			await saveLabels(type, entityKey, {
				...(supportsGroups ? { group_id: groupId } : {}),
				tags,
			});
			await invalidateLabels();
			onSaved?.();
			toast.success(t("labels.saved"), { duration: 3000 });
			onClose();
		} catch (error) {
			toast.error(getAPIErrorMessage(error) ?? t("labels.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			size="sm"
			title={t("labels.editTitle", { name: entityName })}
			footer={
				<>
					<Button variant="outline" size="sm" onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button size="sm" onClick={submit} disabled={saving}>
						{saving ? <Spinner /> : null}
						{t("save")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{supportsGroups && (
					<FormField label={t("groups.group")}>
						<GroupSelect
							type={type as GroupEntityType}
							value={groupId}
							onChange={setGroupId}
						/>
					</FormField>
				)}
				<FormField label={t("tags.title")}>
					<TagsSelect
						value={tags}
						onChange={setTags}
						options={knownTags.map((item) => item.tag)}
					/>
				</FormField>
			</div>
		</AppDialog>
	);
};
