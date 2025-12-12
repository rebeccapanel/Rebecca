import { Box, useColorMode, useColorModeValue } from "@chakra-ui/react";
import JSONEditor, { type JSONEditorMode } from "jsoneditor";
import "jsoneditor/dist/jsoneditor.css";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/theme-github";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import "./styles.css";

export type JSONEditorProps = {
	onChange: (value: string) => void;
	json: any;
	mode?: JSONEditorMode;
};

export const JsonEditor = forwardRef<HTMLDivElement, JSONEditorProps>(
	({ json, onChange, mode = "code" }, ref) => {
		const { colorMode } = useColorMode();

		const jsonEditorContainer = useRef<HTMLDivElement>(null);
		const jsonEditorRef = useRef<JSONEditor | null>(null);
		const latestOnChangeRef = useRef(onChange);
		const pendingPropTextRef = useRef<string | null>(null);

		useEffect(() => {
			latestOnChangeRef.current = onChange;
		}, [onChange]);

		const handleChangeText = useCallback((value: string) => {
			pendingPropTextRef.current = value;
			latestOnChangeRef.current(value);
		}, []);

		useEffect(() => {
			if (!jsonEditorContainer.current) {
				return;
			}

			const editor = new JSONEditor(jsonEditorContainer.current, {
				mode,
				onChangeText: handleChangeText,
				statusBar: false,
				mainMenuBar: false,
				theme: colorMode === "dark" ? "ace/theme/one_dark" : "ace/theme/github",
			});

			jsonEditorRef.current = editor;

			// Ensure ace editor doesn't lose focus
			const aceEditor = editor.aceEditor;
			if (aceEditor) {
				aceEditor.setOptions({
					enableBasicAutocompletion: false,
					enableLiveAutocompletion: false,
				});
				aceEditor.setTheme(
					colorMode === "dark" ? "ace/theme/one_dark" : "ace/theme/github",
				);
			}

			try {
				if (typeof json === "string") {
					editor.setText(json);
				} else if (json !== undefined) {
					editor.set(json);
				}
			} catch {
				if (typeof json === "string") {
					editor.updateText(json);
				}
			}

			return () => {
				editor.destroy();
				jsonEditorRef.current = null;
			};
			// We intentionally create the editor only once.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [colorMode, handleChangeText, json, mode]);

		useEffect(() => {
			const editor = jsonEditorRef.current;
			if (!editor) {
				return;
			}

			const resolveText = (value: JSONEditorProps["json"]): string | null => {
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

			const nextText = resolveText(json);
			if (nextText === null) {
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
			}
		}, [json]);

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
			ace.setTheme(
				colorMode === "dark" ? "ace/theme/one_dark" : "ace/theme/github",
			);
		}, [colorMode]);

		const borderColor = useColorModeValue("gray.300", "whiteAlpha.300");
		const bg = useColorModeValue("surface.light", "surface.dark");
		const shadow = useColorModeValue("sm", "none");

		return (
			<Box
				ref={ref}
				border="1px solid"
				borderColor={borderColor}
				bg={bg}
				borderRadius="lg"
				h="full"
				boxShadow={shadow}
				overflow="hidden"
			>
				<Box height="full" ref={jsonEditorContainer} />
			</Box>
		);
	},
);
