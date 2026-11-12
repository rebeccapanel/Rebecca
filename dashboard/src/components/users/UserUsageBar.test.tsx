import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserUsageBar } from "./UserUsageBar";

Object.assign(globalThis, { React });

const GB = 1024 ** 3;

const render = (used: number, total: number | null) =>
	renderToStaticMarkup(
		<ColorModeProvider>
			<UserUsageBar variant="stacked" used={used} total={total} />
		</ColorModeProvider>,
	);

describe("UserUsageBar stacked variant", () => {
	it("puts used and total under the bar", () => {
		const markup = render(5 * GB, 10 * GB);
		expect(markup).toContain('data-variant="stacked"');
		expect(markup).toContain("5 GB");
		expect(markup).toContain("10 GB");
		expect(markup.indexOf("rb-user-usage-track")).toBeLessThan(
			markup.indexOf("5 GB"),
		);
		expect(markup.indexOf("5 GB")).toBeLessThan(markup.indexOf("10 GB"));
	});

	it("shows an infinity sign instead of a total when unlimited", () => {
		expect(render(2 * GB, null)).toContain("∞");
		expect(render(2 * GB, 0)).toContain("∞");
	});
});
