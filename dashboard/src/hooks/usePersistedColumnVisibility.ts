import { useCallback, useState } from "react";

const PREFIX = "rebecca-columns-";

const read = (key: string): Record<string, boolean> => {
	try {
		const parsed = JSON.parse(localStorage.getItem(PREFIX + key) || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
};

export function usePersistedColumnVisibility(key: string) {
	const [visibility, setVisibility] = useState(() => read(key));
	const update = useCallback(
		(next: Record<string, boolean>) => {
			setVisibility(next);
			try {
				localStorage.setItem(PREFIX + key, JSON.stringify(next));
			} catch {}
		},
		[key],
	);
	return [visibility, update] as const;
}
