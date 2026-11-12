export type AppLanguageCode = "en" | "fa" | "zh-cn" | "ru";

export function resolveAppLanguageCode(language?: string | null): AppLanguageCode {
	const normalized = (language || "").trim().toLowerCase();
	if (normalized.startsWith("fa")) return "fa";
	if (normalized.startsWith("zh")) return "zh-cn";
	if (normalized.startsWith("ru")) return "ru";
	return "en";
}
