import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import twemojiModule from "twemoji";

const twemoji = twemojiModule as typeof twemojiModule & {
	test?: (value: string) => boolean;
};

// Use Twemoji CDN which has complete emoji support (all Unicode emojis)
const TWEMOJI_BASE =
	"https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/";

const EMOJI_OPTIONS = {
	base: TWEMOJI_BASE,
	folder: "72x72",
	ext: ".png",
	className: "twemoji-emoji",
	size: "72x72",
};

const hasEmoji = (value: string | null | undefined) =>
	typeof value === "string" && (twemoji.test?.(value) ?? false);

const shouldParseMutations = (mutations: MutationRecord[]) =>
	mutations.some((mutation) => {
		if (mutation.type === "characterData") {
			return hasEmoji((mutation.target as CharacterData)?.data);
		}

		if (mutation.type === "childList") {
			return Array.from(mutation.addedNodes).some((node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					return hasEmoji(node.textContent);
				}
				if (node.nodeType === Node.ELEMENT_NODE) {
					const element = node as Element;
					if (
						element.tagName === "IMG" &&
						element.classList.contains(EMOJI_OPTIONS.className)
					) {
						return false;
					}
					return hasEmoji(element.textContent);
				}
				return false;
			});
		}

		return false;
	});

export const useAppleEmoji = () => {
	const _location = useLocation();

	useEffect(() => {
		const root = document.body ?? document.getElementById("root");
		if (!root) return;

		const parse = () => {
			twemoji.parse(root, EMOJI_OPTIONS);
		};

		parse();

		const observer = new MutationObserver((mutations) => {
			if (shouldParseMutations(mutations)) {
				requestAnimationFrame(parse);
			}
		});

		observer.observe(root, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		return () => observer.disconnect();
	}, []);
};

export default useAppleEmoji;
