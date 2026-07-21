import { Fragment, memo, useMemo, useState } from "react";

const APPLE_EMOJI_BASE =
	"https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/";
const EMOJI_GRAPHEME =
	/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const failedSources = new Set<string>();
const resolvedSources = new Map<string, string>();

const toCodePoint = (value: string) =>
	Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "")
		.filter(Boolean)
		.filter((codePoint) => codePoint !== "fe0e");

const getSources = (value: string) => {
	const codePoints = toCodePoint(value);
	const full = codePoints.join("-");
	const withoutVariant = codePoints
		.filter((codePoint) => codePoint !== "fe0f")
		.join("-");
	const isSequence = codePoints.includes("200d") || codePoints.includes("20e3");
	const names = isSequence
		? [full, withoutVariant]
		: EMOJI_PRESENTATION.test(value)
			? [withoutVariant, full]
			: [`${withoutVariant}-fe0f`, full, withoutVariant];

	const sources = names
		.filter((name, index) => name && names.indexOf(name) === index)
		.map((name) => `${APPLE_EMOJI_BASE}${name}.png`);
	const resolved = resolvedSources.get(value);

	return [resolved, ...sources].filter(
		(source, index, all): source is string =>
			typeof source === "string" &&
			all.indexOf(source) === index &&
			!failedSources.has(source),
	);
};

const AppleEmojiGlyph = memo(({ value }: { value: string }) => {
	const sources = useMemo(() => getSources(value), [value]);
	const [sourceIndex, setSourceIndex] = useState(0);
	const [isLoaded, setIsLoaded] = useState(false);
	const source = sources[sourceIndex];

	return (
		<span
			className="apple-emoji-glyph"
			data-loaded={isLoaded || undefined}
			role="img"
			aria-label={value}
		>
			<span className="apple-emoji-native" aria-hidden="true">
				{value}
			</span>
			{source && (
				<img
					className="apple-emoji"
					src={source}
					alt=""
					aria-hidden="true"
					draggable={false}
					decoding="async"
					onLoad={() => {
						resolvedSources.set(value, source);
						setIsLoaded(true);
					}}
					onError={() => {
						failedSources.add(source);
						if (resolvedSources.get(value) === source) {
							resolvedSources.delete(value);
						}
						setIsLoaded(false);
						setSourceIndex((index) => index + 1);
					}}
				/>
			)}
		</span>
	);
});

export const AppleEmojiText = memo(({ children }: { children: string }) => {
	const segments = useMemo(
		() => {
			if (!EMOJI_GRAPHEME.test(children)) return null;
			return Array.from(segmenter.segment(children), ({ index, segment }) => ({
				key: `${index}-${segment}`,
				segment,
			}));
		},
		[children],
	);
	if (!segments) return <>{children}</>;

	return (
		<>
			{segments.map(({ key, segment }) =>
				EMOJI_GRAPHEME.test(segment) ? (
					<AppleEmojiGlyph key={key} value={segment} />
				) : (
					<Fragment key={key}>{segment}</Fragment>
				),
			)}
		</>
	);
});
