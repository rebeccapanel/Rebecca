import { useEffect } from "react";

const GRAB_ZONE_PX = 56;
const CLOSE_DISTANCE_PX = 96;
const FLICK_VELOCITY_PX_PER_MS = 0.38;

export const useSheetSwipeToClose = () => {
	useEffect(() => {
		let activeSurface: HTMLElement | null = null;
		let mode: "vertical" | "left" | "right" = "vertical";
		let startX = 0;
		let startY = 0;
		let startTime = 0;
		let currentDelta = 0;
		let axisLocked: "primary" | "cross" | null = null;

		const triggerClose = (surface: HTMLElement) => {
			const closeBtn = surface.querySelector<HTMLElement>(
				'[data-drawer-close="true"], [data-slot="sheet-close"], [data-slot="dialog-close"]',
			);
			if (closeBtn) {
				closeBtn.click();
				return;
			}
			surface.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					code: "Escape",
					bubbles: true,
				}),
			);
		};

		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) return;
			if (!window.matchMedia("(max-width: 768px)").matches) return;

			const target = event.target as HTMLElement | null;
			if (!target) return;
			const tag = target.tagName.toLowerCase();
			if (
				tag === "input" ||
				tag === "textarea" ||
				tag === "select" ||
				target.isContentEditable
			) {
				return;
			}

			const drawer = target.closest<HTMLElement>(".rb-sidebar-drawer");
			const touch = event.touches[0];

			if (drawer) {
				const sideAttr =
					drawer.getAttribute("data-side") ||
					(document.documentElement.dir === "rtl" ? "right" : "left");
				mode = sideAttr === "right" ? "right" : "left";
				activeSurface = drawer;
				startX = touch.clientX;
				startY = touch.clientY;
				startTime = performance.now();
				currentDelta = 0;
				axisLocked = null;
				return;
			}

			const sheet = target.closest<HTMLElement>(
				'[data-slot="sheet-content"], [data-slot="dialog-content"]',
			);
			if (!sheet) return;
			const rect = sheet.getBoundingClientRect();
			if (touch.clientY - rect.top > GRAB_ZONE_PX) return;

			mode = "vertical";
			activeSurface = sheet;
			startX = touch.clientX;
			startY = touch.clientY;
			startTime = performance.now();
			currentDelta = 0;
			axisLocked = null;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!activeSurface || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (!axisLocked) {
				if (Math.hypot(dx, dy) < 10) return;
				if (mode === "vertical") {
					axisLocked = Math.abs(dy) >= Math.abs(dx) ? "primary" : "cross";
				} else {
					axisLocked = Math.abs(dx) >= Math.abs(dy) ? "primary" : "cross";
				}
				if (axisLocked === "primary") {
					activeSurface.style.animation = "none";
					activeSurface.style.transition = "none";
				}
			}

			if (axisLocked !== "primary") return;

			if (mode === "vertical") {
				currentDelta = Math.max(0, dy);
				activeSurface.style.transform = `translate3d(0, ${currentDelta}px, 0)`;
			} else if (mode === "left") {
				currentDelta = Math.max(0, -dx);
				activeSurface.style.transform = `translate3d(-${currentDelta}px, 0, 0)`;
			} else {
				currentDelta = Math.max(0, dx);
				activeSurface.style.transform = `translate3d(${currentDelta}px, 0, 0)`;
			}
		};

		const onTouchEnd = () => {
			if (!activeSurface) return;
			const surface = activeSurface;
			const delta = currentDelta;
			const elapsed = Math.max(1, performance.now() - startTime);
			const velocity = delta / elapsed;
			const wasPrimary = axisLocked === "primary";

			activeSurface = null;
			axisLocked = null;
			currentDelta = 0;

			if (!wasPrimary) return;

			if (delta > CLOSE_DISTANCE_PX || velocity > FLICK_VELOCITY_PX_PER_MS) {
				surface.style.animation = "";
				surface.style.transition = "";
				triggerClose(surface);
				return;
			}

			surface.style.transition =
				"transform 240ms cubic-bezier(0.32, 0.72, 0, 1)";
			surface.style.transform = "";

			window.setTimeout(() => {
				surface.style.transition = "";
				surface.style.animation = "";
			}, 250);
		};

		document.addEventListener("touchstart", onTouchStart, { passive: true });
		document.addEventListener("touchmove", onTouchMove, { passive: true });
		document.addEventListener("touchend", onTouchEnd);
		document.addEventListener("touchcancel", onTouchEnd);

		return () => {
			document.removeEventListener("touchstart", onTouchStart);
			document.removeEventListener("touchmove", onTouchMove);
			document.removeEventListener("touchend", onTouchEnd);
			document.removeEventListener("touchcancel", onTouchEnd);
		};
	}, []);
};
