import { ChakraProvider } from "@chakra-ui/react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFinalMaskCapabilities } from "utils/finalmask";
import { describe, expect, it, vi } from "vitest";
import { FinalMaskEditor } from "./FinalMaskEditor";

Object.assign(globalThis, { React });

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { dir: () => "ltr", language: "en" },
	}),
}));

describe("FinalMaskEditor", () => {
	it("shows layer controls before a host has FinalMask settings", () => {
		const html = renderToStaticMarkup(
			React.createElement(
				ChakraProvider,
				null,
				React.createElement(FinalMaskEditor, {
					value: null,
					onChange: () => undefined,
					capabilities: getFinalMaskCapabilities({
						protocol: "vless",
						network: "tcp",
					}),
				}),
			),
		);
		expect(html).toContain("TCP masks");
		expect(html).toContain("No masks configured.");
	});
});
