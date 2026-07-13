import { useEffect } from "react";
import twemojiModule from "twemoji";

const twemoji = twemojiModule as typeof twemojiModule & {
	test?: (value: string) => boolean;
};

const EMOJI_OPTIONS = {
	base: "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/",
	folder: "apple/64",
	ext: ".png",
	className: "apple-emoji",
};

const hasEmoji = (value: string | null | undefined) =>
	typeof value === "string" && (twemoji.test?.(value) ?? false);

export const useAppleEmoji = () => {
	useEffect(() => {
		const root = document.getElementById("root");
		if (!root) return;

		const pending = new Set<HTMLElement>();
		let frame: number | null = null;

		const flush = () => {
			frame = null;
			for (const element of pending) {
				if (
					element.isConnected &&
					!element.matches("img.apple-emoji") &&
					hasEmoji(element.textContent)
				) {
					twemoji.parse(element, EMOJI_OPTIONS);
				}
			}
			pending.clear();
		};

		const queue = (node: Node) => {
			if (!hasEmoji(node.textContent)) return;
			const element =
				node instanceof HTMLElement ? node : node.parentElement;
			if (!element || element.matches("img.apple-emoji")) return;
			pending.add(element);
			frame ??= window.requestAnimationFrame(flush);
		};

		queue(root);
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "characterData") {
					queue(mutation.target);
					continue;
				}
				mutation.addedNodes.forEach(queue);
			}
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		return () => {
			observer.disconnect();
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, []);
};

export default useAppleEmoji;
