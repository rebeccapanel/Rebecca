import { useEffect, useRef } from "react";

export const useIntervalRefresh = (interval: number, enabled: boolean, refresh: () => void) => {
	const refreshRef = useRef(refresh);
	useEffect(() => {
		refreshRef.current = refresh;
	});
	useEffect(() => {
		if (!interval || !enabled) return;
		const timer = window.setInterval(() => refreshRef.current(), interval);
		return () => window.clearInterval(timer);
	}, [interval, enabled]);
};
