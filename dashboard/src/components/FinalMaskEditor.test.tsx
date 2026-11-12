import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFinalMaskCapabilities } from "utils/finalmask";
import { describe, expect, it, vi } from "vitest";
import { createFinalMaskLayer, FinalMaskEditor } from "./FinalMaskEditor";

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
				ColorModeProvider,
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
		expect(html).toContain("TCP connection masks");
		expect(html).toContain("No TCP mask is active");
	});

	it("creates editable starter values for common masks", () => {
		expect(createFinalMaskLayer("tcp", "fragment")).toEqual({
			type: "fragment",
			settings: {
				packets: "tlshello",
				lengths: ["10-100"],
				delays: ["100-200"],
			},
		});
		expect(createFinalMaskLayer("udp", "header-custom")).toEqual({
			type: "header-custom",
			settings: { client: [{}], server: [{}] },
		});
	});
});
