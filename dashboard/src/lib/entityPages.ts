import { create } from "zustand";

export const ENTITY_PAGE_SECTIONS = [
	"users",
	"admins",
	"services",
	"hosts",
	"nodes",
	"inbounds",
] as const;

export type EntityPageSection = (typeof ENTITY_PAGE_SECTIONS)[number];

export const ENTITY_PAGE_LABELS: Record<EntityPageSection, string> = {
	users: "Users",
	admins: "Admins",
	services: "Services",
	hosts: "Hosts",
	nodes: "Nodes",
	inbounds: "Inbounds",
};

export const EDITOR_PAGE_ID = "rb-editor-page";

const PREFS_KEY = "rb-entity-pages";

const readPrefs = (): Partial<Record<EntityPageSection, boolean>> => {
	try {
		const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
};

export const useEntityPagePrefs = create<{
	pages: Partial<Record<EntityPageSection, boolean>>;
	setPage: (section: EntityPageSection, enabled: boolean) => void;
}>((set) => ({
	pages: readPrefs(),
	setPage: (section, enabled) =>
		set((state) => {
			const pages = { ...state.pages, [section]: enabled };
			try {
				localStorage.setItem(PREFS_KEY, JSON.stringify(pages));
			} catch {}
			return { pages };
		}),
}));

export const useActiveEntityPage = create<{
	section: EntityPageSection | null;
	title: string | null;
	activate: (section: EntityPageSection, title?: string) => void;
	release: (section: EntityPageSection) => void;
}>((set) => ({
	section: null,
	title: null,
	activate: (section, title) => set({ section, title: title ?? null }),
	release: (section) =>
		set((state) =>
			state.section === section ? { section: null, title: null } : state,
		),
}));
