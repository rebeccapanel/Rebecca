import { useEffect } from "react";

const GRAB_ZONE_PX = 80;
const CLOSE_DISTANCE_PX = 100;

const dismissSheet = (dialog: HTMLElement) => {
	const closeBtn = dialog.querySelector<HTMLElement>(
		".chakra-modal__close-btn, button[aria-label='Close'], button[aria-label='close']",
	);
	if (closeBtn) {
		closeBtn.click();
		return;
	}

	const container = dialog.closest(".chakra-modal__content-container");
	const overlay =
		container?.parentElement?.querySelector<HTMLElement>(
			".chakra-modal__overlay",
		) ||
		container?.querySelector<HTMLElement>(".chakra-modal__overlay") ||
		document.querySelector<HTMLElement>(".chakra-modal__overlay");

	if (overlay) {
		overlay.click();
		return;
	}

	const escEvent = new KeyboardEvent("keydown", {
		key: "Escape",
		code: "Escape",
		keyCode: 27,
		which: 27,
		bubbles: true,
		cancelable: true,
		view: window,
	});
	dialog.dispatchEvent(escEvent);
	document.dispatchEvent(escEvent);
	window.dispatchEvent(escEvent);
};

export const useSheetSwipeToClose = () => {
	useEffect(() => {
		let sheet: HTMLElement | null = null;
		let startX = 0;
		let startY = 0;
		let isDragging = false;
		let offset = 0;

		const endTracking = () => {
			if (!sheet) return;
			const dialog = sheet;
			sheet = null;
			isDragging = false;

			const dialogHeight = dialog.offsetHeight || 300;
			const threshold = Math.min(
				CLOSE_DISTANCE_PX,
				Math.max(50, dialogHeight * 0.2),
			);

			if (offset > threshold) {
				dialog.style.transition =
					"transform 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.18s ease-out";
				dialog.style.setProperty("transform", "translateY(100vh)", "important");
				dialog.style.opacity = "0";

				window.setTimeout(() => {
					dismissSheet(dialog);
				}, 60);

				window.setTimeout(() => {
					dialog.style.removeProperty("transition");
					dialog.style.removeProperty("transform");
					dialog.style.removeProperty("opacity");
					dialog.style.removeProperty("animation");
					dialog.style.removeProperty("touch-action");
				}, 320);
			} else {
				dialog.style.transition =
					"transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
				dialog.style.setProperty("transform", "translateY(0px)", "important");

				window.setTimeout(() => {
					dialog.style.removeProperty("transition");
					dialog.style.removeProperty("transform");
					dialog.style.removeProperty("opacity");
					dialog.style.removeProperty("animation");
					dialog.style.removeProperty("touch-action");
				}, 220);
			}
		};

		const checkCanDrag = (target: HTMLElement | null, clientY: number) => {
			if (!target) return null;
			if (
				target.closest(
					"button, a, input, select, textarea, [role='button'], [data-no-sheet-drag='true']",
				)
			) {
				return null;
			}

			const dialog = target.closest<HTMLElement>(".chakra-modal__content");
			if (
				!dialog ||
				!window.matchMedia("(max-width: 768.98px)").matches ||
				dialog.classList.contains("rb-confirm-dialog-content") ||
				dialog.classList.contains("chakra-slide")
			) {
				return null;
			}

			const rect = dialog.getBoundingClientRect();
			const relativeY = clientY - rect.top;

			const isHeaderOrHandle = Boolean(
				target.closest(".chakra-modal__header, [data-sheet-handle='true']") ||
					target === dialog ||
					relativeY <= 40,
			);

			const body = dialog.querySelector<HTMLElement>(".chakra-modal__body");
			const isInsideBody = Boolean(target.closest(".chakra-modal__body"));
			if (isInsideBody && body && body.scrollTop > 0) return null;

			if (!isHeaderOrHandle && (relativeY < -20 || relativeY > GRAB_ZONE_PX)) {
				return null;
			}

			return dialog;
		};

		const onTouchStart = (event: TouchEvent) => {
			if (sheet) return;
			const touch = event.touches[0];
			if (!touch) return;
			const dialog = checkCanDrag(event.target as HTMLElement | null, touch.clientY);
			if (!dialog) return;

			sheet = dialog;
			startX = touch.clientX;
			startY = touch.clientY;
			offset = 0;
			isDragging = false;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!sheet) return;
			const touch = event.touches[0];
			if (!touch) return;

			const deltaY = touch.clientY - startY;
			const deltaX = touch.clientX - startX;

			if (!isDragging) {
				if (deltaY > 4 && Math.abs(deltaY) > Math.abs(deltaX)) {
					isDragging = true;
					sheet.style.animation = "none";
					sheet.style.transition = "none";
					sheet.style.touchAction = "none";
				} else if (Math.abs(deltaX) > 16 || deltaY < -15) {
					sheet = null;
					return;
				}
			}

			if (isDragging) {
				if (event.cancelable) event.preventDefault();
				offset = Math.max(0, deltaY);
				sheet.style.setProperty("transform", `translateY(${offset}px)`, "important");
			}
		};

		const onTouchEnd = () => {
			if (!sheet) return;
			if (!isDragging) {
				sheet = null;
				return;
			}
			endTracking();
		};

		const onPointerDown = (event: PointerEvent) => {
			if (sheet || event.pointerType === "touch") return;
			if (event.pointerType === "mouse" && event.button !== 0) return;
			const dialog = checkCanDrag(event.target as HTMLElement | null, event.clientY);
			if (!dialog) return;

			sheet = dialog;
			startX = event.clientX;
			startY = event.clientY;
			offset = 0;
			isDragging = false;
		};

		const onPointerMove = (event: PointerEvent) => {
			if (!sheet || event.pointerType === "touch") return;

			const deltaY = event.clientY - startY;
			const deltaX = event.clientX - startX;

			if (!isDragging) {
				if (deltaY > 4 && Math.abs(deltaY) > Math.abs(deltaX)) {
					isDragging = true;
					sheet.style.animation = "none";
					sheet.style.transition = "none";
					sheet.style.touchAction = "none";
				} else if (Math.abs(deltaX) > 16 || deltaY < -15) {
					sheet = null;
					return;
				}
			}

			if (isDragging) {
				if (event.cancelable) event.preventDefault();
				offset = Math.max(0, deltaY);
				sheet.style.setProperty("transform", `translateY(${offset}px)`, "important");
			}
		};

		const onPointerUp = (event: PointerEvent) => {
			if (!sheet || event.pointerType === "touch") return;
			if (!isDragging) {
				sheet = null;
				return;
			}
			endTracking();
		};

		window.addEventListener("touchstart", onTouchStart, { passive: true });
		window.addEventListener("touchmove", onTouchMove, { passive: false });
		window.addEventListener("touchend", onTouchEnd, { passive: true });
		window.addEventListener("touchcancel", onTouchEnd, { passive: true });

		window.addEventListener("pointerdown", onPointerDown, { passive: true });
		window.addEventListener("pointermove", onPointerMove, { passive: false });
		window.addEventListener("pointerup", onPointerUp, { passive: true });
		window.addEventListener("pointercancel", onPointerUp, { passive: true });

		return () => {
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("touchend", onTouchEnd);
			window.removeEventListener("touchcancel", onTouchEnd);

			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};
	}, []);
};
