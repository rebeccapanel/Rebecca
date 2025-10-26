import { Box, useColorMode, useColorModeValue } from "@chakra-ui/react";
import JSONEditor, { JSONEditorMode } from "jsoneditor";
import "jsoneditor/dist/jsoneditor.css";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/theme-github";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import "./styles.css";

export type JSONEditorProps = {
  onChange: (value: string) => void;
  json: any;
  mode?: JSONEditorMode;
};

export const JsonEditor = forwardRef<HTMLDivElement, JSONEditorProps>(
  ({ json, onChange, mode = "code" }, ref) => {
    const { colorMode } = useColorMode();
    const theme = useMemo(
      () => (colorMode === "dark" ? "ace/theme/one_dark" : "ace/theme/github"),
      [colorMode]
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<JSONEditor | null>(null);
    const changeHandlerRef = useRef(onChange);

    useEffect(() => {
      changeHandlerRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      editorRef.current = new JSONEditor(containerRef.current!, {
        mode,
        onChangeText: (value) => changeHandlerRef.current(value),
        statusBar: false,
        mainMenuBar: false,
        theme,
      });

      const aceEditor = editorRef.current.aceEditor;
      if (aceEditor) {
        aceEditor.setOptions({
          fontSize: 13,
          fontFamily:
            "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          showPrintMargin: false,
          highlightActiveLine: true,
        });
      }

      return () => {
        editorRef.current?.destroy();
        editorRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (!editorRef.current) return;
      editorRef.current.update(json);
    }, [json]);

    useEffect(() => {
      if (!editorRef.current) return;
      editorRef.current.setMode(mode);
    }, [mode]);

    useEffect(() => {
      const aceEditor = editorRef.current?.aceEditor;
      if (aceEditor) {
        aceEditor.setTheme(theme);
      }
    }, [theme]);

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
        <Box height="full" ref={containerRef} />
      </Box>
    );
  }
);
