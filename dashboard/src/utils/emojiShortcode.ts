export type EmojiShortcode = readonly [name: string, emoji: string, description: string];

export type ShortcodeToken = {
	start: number;
	end: number;
	query: string;
};

export const shortcodeTokenAt = (text: string, caret: number): ShortcodeToken | null => {
	let start = caret;
	while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
	const typed = text.slice(start, caret);
	if (!typed.startsWith(":")) return null;
	const query = typed.slice(1);
	if (!/^[a-z0-9_+-]+$/i.test(query)) return null;
	let end = caret;
	while (end < text.length && !/\s/.test(text[end])) end += 1;
	return { start, end, query: query.toLowerCase() };
};

export const searchEmojiShortcodes = (
	entries: ReadonlyArray<EmojiShortcode>,
	query: string,
	limit = 30,
): EmojiShortcode[] => {
	const prefixMatches: EmojiShortcode[] = [];
	const containsMatches: EmojiShortcode[] = [];
	for (const entry of entries) {
		if (entry[0].startsWith(query)) {
			prefixMatches.push(entry);
		} else if (entry[0].includes(query)) {
			containsMatches.push(entry);
		}
	}
	return [...prefixMatches, ...containsMatches].slice(0, limit);
};

export const emojiShortcodeLabel = (entry: EmojiShortcode) => {
	const text = entry[2].replace(/^flag:\s*/i, "");
	return text.charAt(0).toUpperCase() + text.slice(1);
};

export const emojiShortcodeInsertion = (entry: EmojiShortcode) => `${entry[1]} ${emojiShortcodeLabel(entry)}`;

export const replaceShortcodeToken = (text: string, token: ShortcodeToken, value: string) => ({
	text: text.slice(0, token.start) + value + text.slice(token.end),
	caret: token.start + value.length,
});
