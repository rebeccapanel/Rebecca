import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useColorMode } from "lib/color-mode";

import { cn } from "lib/cn";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/ace";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/theme-github";
import {
	forwardRef,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
	stringifyRebeccaJson,
	type RebeccaJsonContext,
} from "../../utils/jsonFormatting";
import "./styles.css";

export type JSONEditorProps = {
	onChange: (value: string) => void;
	json: unknown;
	label?: string;
	description?: string;
	minHeight?: string | number;
	readOnly?: boolean;
	showToolbar?: boolean;
	canonicalContext?: RebeccaJsonContext;
	toolbarActions?: ReactNode;
	onValidityChange?: (isValid: boolean, error?: string) => void;
	highlightLines?: number[];
	highlightVariant?: "added" | "removed";
	highlightRanges?: Array<{ line: number; start: number; end: number }>;
};

type JsonValidation = {
	valid: boolean;
	error?: string;
	line?: number;
	column?: number;
};

const getJsonText = (value: JSONEditorProps["json"]): string => {
	if (value === undefined || value === null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
};

const lineColumnFromPosition = (text: string, position: number) => {
	const safePosition = Math.max(0, Math.min(position, text.length));
	const before = text.slice(0, safePosition);
	const lines = before.split(/\r\n|\r|\n/);
	return {
		line: lines.length,
		column: (lines[lines.length - 1]?.length ?? 0) + 1,
	};
};

const validateJsonText = (text: string): JsonValidation => {
	const trimmed = text.trim();
	if (!trimmed) {
		return { valid: true };
	}

	try {
		JSON.parse(text);
		return { valid: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const positionMatch = message.match(/position\s+(\d+)/i);
		const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);

		if (lineColumnMatch) {
			return {
				valid: false,
				error: message,
				line: Number(lineColumnMatch[1]),
				column: Number(lineColumnMatch[2]),
			};
		}

		if (positionMatch) {
			const { line, column } = lineColumnFromPosition(
				text,
				Number(positionMatch[1]),
			);
			return { valid: false, error: message, line, column };
		}

		return { valid: false, error: message };
	}
};

export const JsonEditor = forwardRef<HTMLDivElement, JSONEditorProps>(
	(
		{
			json,
			onChange,
			label,
			description,
			minHeight = "320px",
			readOnly = false,
			showToolbar = true,
			canonicalContext,
			toolbarActions,
			onValidityChange,
			highlightLines,
			highlightVariant,
			highlightRanges,
		},
		ref,
	) => {
		const { t } = useTranslation();
		const { colorMode } = useColorMode();
		
		const editorId = useId();

		const aceRef = useRef<AceEditor>(null);
		const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
		const [text, setText] = useState(() => getJsonText(json));
		const lastTextRef = useRef(text);
		const latestOnChangeRef = useRef(onChange);
		const latestOnValidityChangeRef = useRef(onValidityChange);
		const errorMarkerRef = useRef<number | null>(null);
		const highlightMarkerRefs = useRef<number[]>([]);

		const validation = useMemo(() => validateJsonText(text), [text]);

		useEffect(() => {
			latestOnChangeRef.current = onChange;
		}, [onChange]);

		useEffect(() => {
			latestOnValidityChangeRef.current = onValidityChange;
		}, [onValidityChange]);

		useEffect(() => {
			latestOnValidityChangeRef.current?.(validation.valid, validation.error);
		}, [validation]);

		useEffect(() => {
			const next = getJsonText(json);
			if (next === lastTextRef.current) {
				return;
			}
			lastTextRef.current = next;
			setText(next);
		}, [json]);

		const applyText = useCallback((value: string) => {
			lastTextRef.current = value;
			setText(value);
			latestOnChangeRef.current(value);
		}, []);

		const formatJson = useCallback(() => {
			if (!validateJsonText(text).valid) {
				return;
			}
			const parsed = text.trim() ? JSON.parse(text) : {};
			applyText(stringifyRebeccaJson(parsed, 2, canonicalContext));
		}, [applyText, canonicalContext, text]);

		const compactJson = useCallback(() => {
			if (!validateJsonText(text).valid) {
				return;
			}
			const parsed = text.trim() ? JSON.parse(text) : {};
			applyText(stringifyRebeccaJson(parsed, 0, canonicalContext));
		}, [applyText, canonicalContext, text]);

		const copyJson = useCallback(() => {
			void copyTextToClipboard(text).then(() => {
				toast.success(t("copied"), { duration: 1400 });
			});
		}, [t, text, toast]);

		const validationLabel = useMemo(() => {
			if (validation.valid) {
				return t("jsonEditor.valid");
			}
			if (validation.line && validation.column) {
				return t("jsonEditor.invalidAt", { line: validation.line, column: validation.column });
			}
			return t("jsonEditor.invalid");
		}, [t, validation]);

		useEffect(() => {
			aceRef.current?.editor?.setOption("scrollPastEnd", 0.2);
			aceRef.current?.editor?.session.setUseWorker(false);
		}, []);

		useEffect(() => {
			const container = aceRef.current?.editor?.container;
			if (!container) {
				return;
			}
			const containWheelScroll = (event: WheelEvent) => {
				event.stopPropagation();
				const session = aceRef.current?.editor?.session;
				const renderer = aceRef.current?.editor?.renderer as any;
				if (!session || !renderer) {
					return;
				}
				const scrollTop = session.getScrollTop();
				const lineHeight = Number(renderer.lineHeight) || 16;
				const contentHeight = session.getLength() * lineHeight;
				const viewportHeight =
					renderer.scroller?.clientHeight || renderer.$size?.scrollerHeight || 0;
				const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
				const atTop = scrollTop <= 0;
				const atBottom = scrollTop >= maxScrollTop - 1;
				if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
					event.preventDefault();
				}
			};
			container.addEventListener("wheel", containWheelScroll, { passive: false });
			return () => container.removeEventListener("wheel", containWheelScroll);
		}, []);

		useEffect(() => {
			const editor = aceRef.current?.editor;
			const session = editor?.session;
			if (!editor || !session) {
				return;
			}
			for (const marker of highlightMarkerRefs.current) {
				session.removeMarker(marker);
			}
			highlightMarkerRefs.current = [];
			if (
				!highlightVariant ||
				(!highlightLines?.length && !highlightRanges?.length)
			) {
				return;
			}
			const Range = editor.getSelectionRange().constructor as any;
			for (const line of highlightLines ?? []) {
				const row = Math.max(0, line - 1);
				highlightMarkerRefs.current.push(
					session.addMarker(
						new Range(row, 0, row, 1),
						`rebecca-json-diff-${highlightVariant}`,
						"fullLine",
						true,
					),
				);
			}
			for (const range of highlightRanges ?? []) {
				const row = Math.max(0, range.line - 1);
				const start = Math.max(0, range.start);
				const end = Math.max(start + 1, range.end);
				highlightMarkerRefs.current.push(
					session.addMarker(
						new Range(row, start, row, end),
						`rebecca-json-diff-${highlightVariant}-text`,
						"text",
						false,
					),
				);
			}
		}, [highlightLines, highlightRanges, highlightVariant]);

		useEffect(() => {
			const editor = aceRef.current?.editor;
			const session = editor?.session;
			if (!editor || !session) {
				return;
			}
			if (errorMarkerRef.current !== null) {
				session.removeMarker(errorMarkerRef.current);
				errorMarkerRef.current = null;
			}
			if (validation.valid) {
				session.setAnnotations([]);
				return;
			}
			const row = Math.max(0, (validation.line || 1) - 1);
			session.setAnnotations([
				{
					row,
					column: Math.max(0, (validation.column || 1) - 1),
					text: validation.error || validationLabel,
					type: "error",
				},
			]);
			const Range = editor.getSelectionRange().constructor as any;
			errorMarkerRef.current = session.addMarker(
				new Range(row, 0, row, 1),
				"rebecca-json-error-line",
				"fullLine",
				true,
			);
		}, [validation, validationLabel]);

		const borderColor = "border-[var(--rb-panel-border)]!";
		const bg = "bg-[var(--rb-panel-surface)]";
		const elevatedBg = "bg-[var(--rb-panel-elevated)]";
		const textColor = "text-[var(--rb-panel-text)]";
		const mutedColor = "text-[var(--rb-panel-text-muted)]";

		return (
			<div ref={ref} style={{ minHeight: minHeight }} className={cn(cn("flex flex-col items-stretch border rounded-[10px] h-full overflow-hidden gap-0", bg, borderColor, textColor, "rebecca-json-editor"))}>
				{showToolbar && (
					<div className={cn("flex flex-row items-center border-b flex-wrap justify-between min-h-[44px] px-3 py-2 gap-3", elevatedBg, borderColor)}>
						<div className="flex-1 min-w-[180px]!">
							{label ? (
								<p className="text-[0.875rem] font-extrabold truncate">
									{label}
								</p>
							) : null}
							{description ? (
								<p className={cn("text-[0.75rem] line-clamp-2", mutedColor)}>
									{description}
								</p>
							) : null}
						</div>
						<div className="flex flex-row items-center shrink-0 flex-wrap justify-end max-w-[100%] gap-2">
							<Tooltip>
<TooltipTrigger asChild>
								<Badge className={cn(toneClass(validation.valid ? "green" : "red"), "rounded-full px-2 py-1")}>
									{validationLabel}
								</Badge>
							</TooltipTrigger>
<TooltipContent>{validation.error || validationLabel}</TooltipContent>
</Tooltip>
							<Button onClick={formatJson} variant="outline" size="xs" className="shrink-0">
								{t("jsonEditor.format")}
							</Button>
							<Button onClick={compactJson} variant="outline" size="xs" className="shrink-0">
								{t("jsonEditor.compact")}
							</Button>
							<Button onClick={copyJson} variant="ghost" size="xs" className="shrink-0">
								{t("copy")}
							</Button>
							{toolbarActions}
						</div>
					</div>
				)}
				<div className="flex-1 min-h-[260px] md:min-h-0 relative">
					<div className="absolute inset-0">
						<AceEditor
							ref={aceRef}
							name={`json-editor-${editorId}`}
							mode="json"
							theme={colorMode === "dark" ? "one_dark" : "github"}
							value={text}
							onChange={applyText}
							readOnly={readOnly}
							width="100%"
							height="100%"
							fontSize={isTouch ? 12 : 13}
							tabSize={2}
							wrapEnabled={isTouch}
							showPrintMargin={false}
							highlightActiveLine
							enableBasicAutocompletion={!isTouch}
							enableLiveAutocompletion={false}
							enableSnippets={false}
							setOptions={{ highlightSelectedWord: true, useSoftTabs: true }}
						/>
					</div>
				</div>
			</div>
		);
	},
);
