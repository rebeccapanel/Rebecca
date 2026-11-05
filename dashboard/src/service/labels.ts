import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetch } from "service/http";

export type LabelEntityType = "user" | "admin" | "host" | "inbound" | "node";
export type GroupEntityType = "user" | "admin";

export type LabelGroup = {
	id: number;
	type: GroupEntityType;
	name: string;
	member_count?: number;
};

export type TagCount = { tag: string; count: number };

export type EntityLabels = {
	group: Pick<LabelGroup, "id" | "name"> | null;
	tags: string[];
};

export type LabelItemsResponse = {
	items: Record<string, EntityLabels>;
	groups: LabelGroup[];
	tags: TagCount[];
};

export type LabelAssignment = {
	group_id?: number | null;
	tags?: string[];
};

export const NO_GROUP_FILTER = "none";

export const labelKeys = {
	all: ["labels"] as const,
	groups: (type: GroupEntityType) => ["labels", "groups", type] as const,
	tags: (type: LabelEntityType) => ["labels", "tags", type] as const,
	items: (type: LabelEntityType) => ["labels", "items", type] as const,
};

export const normalizeTag = (value: string) =>
	value.trim().replace(/\s+/g, " ").toLowerCase();

export const normalizeTags = (values: string[]) => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const tag = normalizeTag(value);
		if (tag && !seen.has(tag)) {
			seen.add(tag);
			result.push(tag);
		}
	}
	return result;
};

export const fetchGroups = (type: GroupEntityType) =>
	fetch<{ groups: LabelGroup[] }>("/groups", { query: { type } }).then(
		(response) => response.groups ?? [],
	);

export const createGroup = (type: GroupEntityType, name: string) =>
	fetch<LabelGroup>("/groups", { method: "POST", body: { type, name } });

export const renameGroup = (id: number, name: string) =>
	fetch<LabelGroup>(`/groups/${id}`, { method: "PUT", body: { name } });

export const deleteGroup = (id: number) =>
	fetch(`/groups/${id}`, { method: "DELETE" });

export const fetchTags = (type: LabelEntityType) =>
	fetch<{ tags: TagCount[] }>("/tags", { query: { type } }).then(
		(response) => response.tags ?? [],
	);

export const fetchLabelItems = (type: Exclude<LabelEntityType, "user">) =>
	fetch<LabelItemsResponse>(`/labels/${type}`);

export const saveLabels = (
	type: LabelEntityType,
	key: string | number,
	assignment: LabelAssignment,
) =>
	fetch<EntityLabels>(`/labels/${type}/${encodeURIComponent(String(key))}`, {
		method: "PUT",
		body: assignment,
	});

export const useGroups = (type: GroupEntityType, enabled = true) =>
	useQuery({
		queryKey: labelKeys.groups(type),
		queryFn: () => fetchGroups(type),
		enabled,
		staleTime: 15_000,
	});

export const useTags = (type: LabelEntityType, enabled = true) =>
	useQuery({
		queryKey: labelKeys.tags(type),
		queryFn: () => fetchTags(type),
		enabled,
		staleTime: 15_000,
	});

export const useLabelItems = (
	type: Exclude<LabelEntityType, "user">,
	enabled = true,
) =>
	useQuery({
		queryKey: labelKeys.items(type),
		queryFn: () => fetchLabelItems(type),
		enabled,
		staleTime: 15_000,
	});

export const useInvalidateLabels = () => {
	const queryClient = useQueryClient();
	return useCallback(
		() => queryClient.invalidateQueries({ queryKey: labelKeys.all }),
		[queryClient],
	);
};
