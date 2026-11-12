import { dashboardPath } from "utils/dashboardBase";
import { fetch as apiFetch } from "./http";

export type PushPermission = NotificationPermission | "unsupported";

export const pushSupported = () =>
	typeof window !== "undefined" &&
	"serviceWorker" in navigator &&
	"PushManager" in window &&
	"Notification" in window;

export const isIosDevice = () =>
	typeof navigator !== "undefined" &&
	(/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
	typeof window !== "undefined" &&
	((window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
		(window.navigator as Navigator & { standalone?: boolean }).standalone === true);

export const currentPermission = (): PushPermission =>
	pushSupported() ? Notification.permission : "unsupported";

const keyBytes = (value: string) => {
	const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
	const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const sameKey = (current: ArrayBuffer | null | undefined, wanted: Uint8Array) => {
	if (!current) return false;
	const bytes = new Uint8Array(current);
	return bytes.length === wanted.length && bytes.every((value, index) => value === wanted[index]);
};

const registerWorker = async () => {
	const scope = dashboardPath("/");
	await navigator.serviceWorker.register("/rebecca-admin-sw.js", { scope });
	return navigator.serviceWorker.ready;
};

const subscriptionPayload = (subscription: PushSubscription) => {
	const json = subscription.toJSON();
	return {
		endpoint: json.endpoint,
		keys: json.keys,
		page_url: dashboardPath("/notifications"),
	};
};

const sendSubscription = (subscription: PushSubscription) =>
	apiFetch("/notifications/push/subscribe", {
		method: "POST",
		body: JSON.stringify(subscriptionPayload(subscription)),
	});

export const getBrowserSubscription = async () => {
	if (!pushSupported()) return null;
	const registration = await navigator.serviceWorker.getRegistration(dashboardPath("/"));
	return registration ? registration.pushManager.getSubscription() : null;
};

export const syncPushSubscription = async () => {
	if (!pushSupported() || Notification.permission !== "granted") return false;
	const registration = await registerWorker();
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return false;
	await sendSubscription(subscription);
	return true;
};

export const enablePush = async () => {
	if (!pushSupported()) throw new Error("unsupported");
	const permission = await Notification.requestPermission();
	if (permission !== "granted") return false;
	const registration = await registerWorker();
	const config = await apiFetch<{ public_key: string }>("/notifications/push/config");
	const wanted = keyBytes(config.public_key);
	let subscription = await registration.pushManager.getSubscription();
	if (subscription && !sameKey(subscription.options.applicationServerKey, wanted)) {
		await subscription.unsubscribe();
		subscription = null;
	}
	if (!subscription) {
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: wanted as BufferSource,
		});
	}
	await sendSubscription(subscription);
	return true;
};

export const disablePush = async () => {
	const subscription = await getBrowserSubscription();
	if (!subscription) return;
	const endpoint = subscription.endpoint;
	await apiFetch("/notifications/push/unsubscribe", {
		method: "POST",
		body: JSON.stringify({ endpoint }),
	}).catch(() => undefined);
	await subscription.unsubscribe();
};
