import { useLayoutEffect } from "react";
import { create } from "zustand";

interface ShellLoadingState {
	activeScopes: Record<string, number>;
	begin: (scope: string) => void;
	end: (scope: string) => void;
}

export const useShellLoading = create<ShellLoadingState>((set) => ({
	activeScopes: {},
	begin: (scope) =>
		set((state) => ({
			activeScopes: {
				...state.activeScopes,
				[scope]: (state.activeScopes[scope] ?? 0) + 1,
			},
		})),
	end: (scope) =>
		set((state) => {
			const nextCount = (state.activeScopes[scope] ?? 0) - 1;
			if (nextCount > 0) {
				return {
					activeScopes: {
						...state.activeScopes,
						[scope]: nextCount,
					},
				};
			}
			const next = { ...state.activeScopes };
			delete next[scope];
			return { activeScopes: next };
		}),
}));

export function useRegisterShellLoading(active: boolean, scope = "page") {
	useLayoutEffect(() => {
		if (!active) return;
		useShellLoading.getState().begin(scope);
		return () => {
			useShellLoading.getState().end(scope);
		};
	}, [active, scope]);
}
