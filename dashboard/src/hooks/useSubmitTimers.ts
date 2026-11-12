import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from "react";

export type SubmitStatus = "idle" | "loading" | "success" | "error";

const ERROR_RESET_DELAY_MS = 900;

export const useSubmitTimers = (setSubmitStatus: Dispatch<SetStateAction<SubmitStatus>>) => {
	const resetTimerRef = useRef<number | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const clearSubmitTimers = useCallback(() => {
		if (resetTimerRef.current !== null) {
			window.clearTimeout(resetTimerRef.current);
			resetTimerRef.current = null;
		}
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	useEffect(() => clearSubmitTimers, [clearSubmitTimers]);

	const showSubmitError = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
		setSubmitStatus("error");
		resetTimerRef.current = window.setTimeout(() => {
			setSubmitStatus("idle");
			resetTimerRef.current = null;
		}, ERROR_RESET_DELAY_MS);
	}, [setSubmitStatus]);

	return { closeTimerRef, clearSubmitTimers, showSubmitError };
};
