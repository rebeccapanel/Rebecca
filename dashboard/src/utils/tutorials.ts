export const normalizeTutorialLang = (lang?: string | null) =>
	(lang || "en").toLowerCase().startsWith("fa") ? "fa" : "en";

const normalizeDashboardRoot = (root: string) => {
	const normalized = root.replace(/\/+$/, "");
	return normalized === "/" ? "" : normalized;
};

const tutorialContentPath = "tutorial-content";

export const getTutorialsUrl = (
	dashboardRoot: string,
	lang?: string | null,
	page = "",
) => {
	const root = normalizeDashboardRoot(dashboardRoot);
	const locale = normalizeTutorialLang(lang) === "fa" ? "fa/" : "";
	return `${root}/${tutorialContentPath}/${locale}docs/${page.replace(/^\/+/, "")}`;
};

export const getTutorialManifestUrl = (dashboardRoot: string) =>
	`${normalizeDashboardRoot(dashboardRoot)}/${tutorialContentPath}/manifest.json`;

export const getTutorialSeenKey = (lang?: string | null) =>
	`rb-tutorials-seen-${normalizeTutorialLang(lang)}`;
