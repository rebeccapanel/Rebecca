import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Textarea } from "components/ui/textarea";
import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";


import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useGetUser from "hooks/useGetUser";
import { fetch as apiFetch, getAPIErrorMessage } from "service/http";
import { AdminRole } from "types/Admin";

export type EntityNoteType = "admin" | "host" | "inbound";

export type EntityNote = {
	note: string;
	updated_by: string;
	updated_at: number;
};

const NOTE_MAX_LENGTH = 4000;

export const canViewEntityNotes = (userData: ReturnType<typeof useGetUser>["userData"]) =>
	(userData?.role === AdminRole.Sudo && Boolean(userData?.permissions?.sudo?.notes)) ||
	userData?.role === AdminRole.FullAccess;

export const EntityNotePanel: FC<{
	entityType: EntityNoteType;
	entityKey: string | number;
}> = ({ entityType, entityKey }) => {
	const { t } = useTranslation();
	
	const queryClient = useQueryClient();
	const { userData } = useGetUser();
	const canView = canViewEntityNotes(userData);
	const key = String(entityKey);
	const path = `/notes/${entityType}/${encodeURIComponent(key)}`;
	const queryKey = ["entity-note", entityType, key];
	const { data, isLoading } = useQuery<EntityNote>({ queryKey: [queryKey], queryFn: () => apiFetch<EntityNote>(path), enabled: canView });
	const [draft, setDraft] = useState("");

	useEffect(() => {
		setDraft(data?.note ?? "");
	}, [data]);

	const { mutate: save, isPending: isSaving } = useMutation({ mutationFn: (note: string) =>
			apiFetch<EntityNote>(path, { method: "PUT", body: { note } }), onSuccess: (saved) => {
				queryClient.setQueryData([queryKey], saved);
				toast.success(t("entityNote.saved"));
			},
			onError: (error) => {
				toast.error(getAPIErrorMessage(error) ?? t("entityNote.saveFailed"));
			}, });

	if (!canView) {
		return null;
	}
	const dirty = draft.trim() !== (data?.note ?? "");
	return (
		<Field>
			<FieldLabel>{t("entityNote.label")}</FieldLabel>
			<Textarea rows={3} maxLength={NOTE_MAX_LENGTH} value={draft} disabled={isLoading} onChange={(event) => setDraft(event.target.value)} />
			<FieldDescription>{t("entityNote.hint")}</FieldDescription>
			{data?.updated_by ? (
				<FieldDescription>
					{t("entityNote.lastEdited", { name: data.updated_by })}
				</FieldDescription>
			) : null}
			<div className="flex flex-row items-center gap-2 justify-end mt-2">
				<Button disabled={!dirty || isLoading} onClick={() => save(draft.trim())} size="sm" loading={isSaving}>
					{t("entityNote.save")}
				</Button>
			</div>
		</Field>
	);
};
