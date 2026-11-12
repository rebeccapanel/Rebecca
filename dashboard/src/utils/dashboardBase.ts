let dashboardBase = "/dashboard";
let installPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

export type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const getDashboardBase = () => dashboardBase;

export const dashboardPath = (suffix: string) => {
	const base = dashboardBase === "/" ? "" : dashboardBase.replace(/\/+$/, "");
	return `${base}${suffix}`;
};

export const setDashboardBase = (value: string) => {
	dashboardBase = value || "/";
	if (typeof document === "undefined") return;
	const href = `/api/notifications/push/manifest?path=${encodeURIComponent(dashboardBase === "/" ? "" : dashboardBase)}`;
	let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
	if (!link) {
		link = document.createElement("link");
		link.rel = "manifest";
		document.head.appendChild(link);
	}
	link.href = href;
};

export const getInstallPrompt = () => installPrompt;

export const subscribeInstallPrompt = (listener: () => void) => {
	installListeners.add(listener);
	return () => {
		installListeners.delete(listener);
	};
};

export const clearInstallPrompt = () => {
	installPrompt = null;
	installListeners.forEach((listener) => {
		listener();
	});
};

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		installPrompt = event as BeforeInstallPromptEvent;
		installListeners.forEach((listener) => {
			listener();
		});
	});
	window.addEventListener("appinstalled", clearInstallPrompt);
}
