import {
	Badge,
	Box,
	Button,
	HStack,
	Text,
	Tooltip,
	useColorMode,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import JSONEditor, { type JSONEditorMode } from "jsoneditor";
import "jsoneditor/dist/jsoneditor.css";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/theme-github";
import {
	forwardRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
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
	mode?: JSONEditorMode;
	label?: string;
	description?: string;
	minHeight?: string | number;
	readOnly?: boolean;
	showToolbar?: boolean;
	canonicalContext?: RebeccaJsonContext;
	toolbarActions?: ReactNode;
	onValidityChange?: (isValid: boolean, error?: string) => void;
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
			mode = "code",
			label,
			description,
			minHeight = "320px",
			readOnly = false,
			showToolbar = true,
			canonicalContext,
			toolbarActions,
			onValidityChange,
		},
		ref,
	) => {
		const { t } = useTranslation();
		const { colorMode } = useColorMode();
		const toast = useToast();

		const jsonEditorContainer = useRef<HTMLDivElement>(null);
		const jsonEditorRef = useRef<JSONEditor | null>(null);
		const latestOnChangeRef = useRef(onChange);
		const latestOnValidityChangeRef = useRef(onValidityChange);
		const pendingPropTextRef = useRef<string | null>(null);
		const lastEmittedTextRef = useRef<string>("");
		const errorMarkerRef = useRef<number | null>(null);
		const validationTimerRef = useRef<number | null>(null);
		const [validation, setValidation] = useState<JsonValidation>(() =>
			validateJsonText(getJsonText(json)),
		);

		useEffect(() => {
			latestOnChangeRef.current = onChange;
		}, [onChange]);

		useEffect(() => {
			latestOnValidityChangeRef.current = onValidityChange;
		}, [onValidityChange]);

		const emitValidation = useCallback((next: JsonValidation) => {
			setValidation(next);
			latestOnValidityChangeRef.current?.(next.valid, next.error);
		}, []);

		const scheduleValidation = useCallback(
			(value: string, immediate = false) => {
				if (validationTimerRef.current !== null) {
					window.clearTimeout(validationTimerRef.current);
					validationTimerRef.current = null;
				}
				const run = () => {
					validationTimerRef.current = null;
					emitValidation(validateJsonText(value));
				};
				if (immediate) {
					run();
					return;
				}
				validationTimerRef.current = window.setTimeout(run, 140);
			},
			[emitValidation],
		);

		const handleChangeText = useCallback(
			(value: string) => {
				pendingPropTextRef.current = value;
				lastEmittedTextRef.current = value;
				scheduleValidation(value);
				latestOnChangeRef.current(value);
			},
			[scheduleValidation],
		);

		const themeName = colorMode === "dark" ? "ace/theme/one_dark" : "ace/theme/github";
		const runWithEditorText = useCallback(
			(handler: (text: string, editor: JSONEditor) => void) => {
				const editor = jsonEditorRef.current;
				if (!editor) {
					return;
				}
				let text = "";
				try {
					text = editor.getText();
				} catch {
					text = lastEmittedTextRef.current;
				}
				handler(text, editor);
			},
			[],
		);

		const setEditorText = useCallback(
			(editor: JSONEditor, value: string) => {
				try {
					editor.updateText(value);
				} catch {
					editor.setText(value);
				}
				pendingPropTextRef.current = value;
				lastEmittedTextRef.current = value;
				scheduleValidation(value, true);
				latestOnChangeRef.current(value);
			},
			[scheduleValidation],
		);

		const formatJson = useCallback(() => {
			runWithEditorText((text, editor) => {
				const nextValidation = validateJsonText(text);
				if (!nextValidation.valid) {
					emitValidation(nextValidation);
					return;
				}
				const parsed = text.trim() ? JSON.parse(text) : {};
				setEditorText(editor, stringifyRebeccaJson(parsed, 2, canonicalContext));
			});
		}, [canonicalContext, emitValidation, runWithEditorText, setEditorText]);

		const compactJson = useCallback(() => {
			runWithEditorText((text, editor) => {
				const nextValidation = validateJsonText(text);
				if (!nextValidation.valid) {
					emitValidation(nextValidation);
					return;
				}
				const parsed = text.trim() ? JSON.parse(text) : {};
				setEditorText(editor, stringifyRebeccaJson(parsed, 0, canonicalContext));
			});
		}, [canonicalContext, emitValidation, runWithEditorText, setEditorText]);

		const copyJson = useCallback(async () => {
			runWithEditorText((text) => {
				void copyTextToClipboard(text).then(() => {
					toast({
						status: "success",
						title: t("jsonEditor.copied", "Copied"),
						duration: 1400,
						isClosable: true,
					});
				});
			});
		}, [runWithEditorText, t, toast]);

		const validationLabel = useMemo(() => {
			if (validation.valid) {
				return t("jsonEditor.valid", "Valid JSON");
			}
			if (validation.line && validation.column) {
				return t("jsonEditor.invalidAt", {
					defaultValue: "Invalid JSON at line {{line}}, column {{column}}",
					line: validation.line,
					column: validation.column,
				});
			}
			return t("jsonEditor.invalid", "Invalid JSON");
		}, [t, validation]);

		// biome-ignore lint/correctness/useExhaustiveDependencies: create editor once
		useEffect(() => {
			if (!jsonEditorContainer.current) {
				return;
			}

			const editor = new JSONEditor(jsonEditorContainer.current, {
				mode,
				onChangeText: handleChangeText,
				statusBar: false,
				mainMenuBar: false,
				theme: themeName,
			});

			jsonEditorRef.current = editor;

			const aceEditor = editor.aceEditor;
			if (aceEditor) {
				aceEditor.setOptions({
					enableBasicAutocompletion: true,
					enableLiveAutocompletion: false,
					enableSnippets: false,
					fontSize: "13px",
					highlightActiveLine: true,
					highlightSelectedWord: true,
					readOnly,
					scrollPastEnd: 0.2,
					showPrintMargin: false,
					tabSize: 2,
					useSoftTabs: true,
					wrap: false,
				});
				aceEditor.session?.setMode?.("ace/mode/json");
				aceEditor.setTheme(themeName);
			}

			try {
				if (typeof json === "string") {
					editor.setText(json);
					lastEmittedTextRef.current = json;
					scheduleValidation(json, true);
				} else if (json !== undefined) {
					editor.set(json);
					try {
						lastEmittedTextRef.current = editor.getText();
					} catch {
						lastEmittedTextRef.current = "";
					}
					scheduleValidation(lastEmittedTextRef.current, true);
				}
			} catch {
				if (typeof json === "string") {
					editor.updateText(json);
					lastEmittedTextRef.current = json;
					scheduleValidation(json, true);
				}
			}

			const containWheelScroll = (event: WheelEvent) => {
				event.stopPropagation();
				const ace = editor.aceEditor as any;
				const session = ace?.session;
				const renderer = ace?.renderer;
				if (!session || !renderer) {
					return;
				}
				const scrollTop =
					typeof session.getScrollTop === "function"
						? session.getScrollTop()
						: 0;
				const lineHeight = Number(renderer.lineHeight) || 16;
				const rowCount =
					typeof session.getLength === "function" ? session.getLength() : 0;
				const contentHeight = rowCount * lineHeight;
				const viewportHeight =
					renderer.scroller?.clientHeight ||
					renderer.$size?.scrollerHeight ||
					0;
				const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
				const atTop = scrollTop <= 0;
				const atBottom = scrollTop >= maxScrollTop - 1;
				if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
					event.preventDefault();
				}
			};
			editor.aceEditor?.container?.addEventListener(
				"wheel",
				containWheelScroll,
				{ passive: false },
			);

			return () => {
				if (validationTimerRef.current !== null) {
					window.clearTimeout(validationTimerRef.current);
					validationTimerRef.current = null;
				}
				editor.aceEditor?.container?.removeEventListener(
					"wheel",
					containWheelScroll,
				);
				editor.destroy();
				jsonEditorRef.current = null;
			};
		}, []);

		useEffect(() => {
			const editor = jsonEditorRef.current;
			if (!editor) {
				return;
			}

			const nextText = getJsonText(json);

			if (nextText === lastEmittedTextRef.current) {
				pendingPropTextRef.current = null;
				scheduleValidation(nextText, true);
				return;
			}

			if (pendingPropTextRef.current !== null) {
				let normalizedPending = pendingPropTextRef.current;
				try {
					normalizedPending = JSON.stringify(
						JSON.parse(pendingPropTextRef.current),
						null,
						2,
					);
				} catch {
					// pending text is not valid JSON yet; use raw value
				}

				pendingPropTextRef.current = null;
				if (normalizedPending === nextText) {
					lastEmittedTextRef.current = nextText;
					return;
				}
			}

			let currentText: string | null = null;
			try {
				currentText = editor.getText();
			} catch {
				currentText = null;
			}

			if (currentText === nextText) {
				return;
			}

			if (typeof json === "string") {
				try {
					editor.updateText(nextText);
				} catch {
					editor.setText(nextText);
				}
				lastEmittedTextRef.current = nextText;
				scheduleValidation(nextText, true);
			} else {
				const safeValue =
					json === undefined || json === null
						? {}
						: (json as Record<string, unknown>);
				try {
					editor.update(safeValue);
				} catch {
					editor.set(safeValue);
				}
				try {
					lastEmittedTextRef.current = editor.getText();
				} catch {
					lastEmittedTextRef.current = nextText;
				}
				scheduleValidation(lastEmittedTextRef.current, true);
			}
		}, [json, scheduleValidation]);

		useEffect(() => {
			const editor = jsonEditorRef.current;
			if (!editor) {
				return;
			}
			try {
				if (editor.getMode && editor.getMode() !== mode) {
					editor.setMode(mode);
				} else if (!editor.getMode) {
					editor.setMode(mode);
				}
			} catch {
				editor.setMode(mode);
			}
		}, [mode]);

		useEffect(() => {
			const ace = jsonEditorRef.current?.aceEditor;
			if (!ace) {
				return;
			}
			ace.setTheme(themeName);
		}, [themeName]);

		useEffect(() => {
			const ace = jsonEditorRef.current?.aceEditor;
			if (!ace) {
				return;
			}
			ace.setOptions({ readOnly });
		}, [readOnly]);

		useEffect(() => {
			const ace = jsonEditorRef.current?.aceEditor as any;
			const session = ace?.session;
			if (!session?.setAnnotations) {
				return;
			}
			if (errorMarkerRef.current !== null && session.removeMarker) {
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
			const Range = ace?.getSelectionRange?.()?.constructor;
			if (Range && session.addMarker) {
				errorMarkerRef.current = session.addMarker(
					new Range(row, 0, row, 1),
					"rebecca-json-error-line",
					"fullLine",
					true,
				);
			}
		}, [validation, validationLabel]);

		const borderColor = useColorModeValue(
			"var(--rb-panel-border)",
			"var(--rb-panel-border)",
		);
		const bg = useColorModeValue(
			"var(--rb-panel-surface)",
			"var(--rb-panel-surface)",
		);
		const elevatedBg = useColorModeValue(
			"var(--rb-panel-elevated)",
			"var(--rb-panel-elevated)",
		);
		const textColor = useColorModeValue(
			"var(--rb-panel-text)",
			"var(--rb-panel-text)",
		);
		const mutedColor = useColorModeValue(
			"var(--rb-panel-text-muted)",
			"var(--rb-panel-text-muted)",
		);

		return (
			<VStack
				ref={ref}
				align="stretch"
				bg={bg}
				border="1px solid"
				borderColor={borderColor}
				borderRadius="10px"
				className="rebecca-json-editor"
				color={textColor}
				h="full"
				minH={minHeight}
				overflow="hidden"
				spacing={0}
			>
				{showToolbar && (
					<HStack
						bg={elevatedBg}
						borderBottom="1px solid"
						borderColor={borderColor}
						flexWrap="wrap"
						justify="space-between"
						minH="44px"
						px={3}
						py={2}
						spacing={3}
					>
						<Box flex="1" minW="180px">
							{label ? (
								<Text fontSize="sm" fontWeight="800" noOfLines={1}>
									{label}
								</Text>
							) : null}
							{description ? (
								<Text color={mutedColor} fontSize="xs" noOfLines={2}>
									{description}
								</Text>
							) : null}
						</Box>
						<HStack
							flexShrink={0}
							flexWrap="wrap"
							justify="flex-end"
							maxW="100%"
							spacing={2}
						>
							<Tooltip label={validation.error || validationLabel} hasArrow>
								<Badge
									borderRadius="full"
									colorScheme={validation.valid ? "green" : "red"}
									px={2}
									py={1}
								>
									{validationLabel}
								</Badge>
							</Tooltip>
							<Button flexShrink={0} size="xs" variant="outline" onClick={formatJson}>
								{t("jsonEditor.format", "Format")}
							</Button>
							<Button flexShrink={0} size="xs" variant="outline" onClick={compactJson}>
								{t("jsonEditor.compact", "Compact")}
							</Button>
							<Button flexShrink={0} size="xs" variant="ghost" onClick={copyJson}>
								{t("jsonEditor.copy", "Copy")}
							</Button>
							{toolbarActions}
						</HStack>
					</HStack>
				)}
				<Box flex="1" minH={0} ref={jsonEditorContainer} />
			</VStack>
		);
	},
);
