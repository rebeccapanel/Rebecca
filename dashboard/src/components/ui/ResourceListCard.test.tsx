import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceSummaryPills } from "./ResourceListCard";

Object.assign(globalThis, { React });

describe("ResourceSummaryPills", () => {
	it("renders each label with its value and nothing for an empty list", () => {
		const markup = renderToStaticMarkup(
			<ColorModeProvider>
				<ResourceSummaryPills
					items={[
						{ label: "Usage", value: "1.5 GB", colorScheme: "blue" },
						{ label: "Speed", value: "↑ 1 MB/s · ↓ 2 MB/s" },
					]}
				/>
			</ColorModeProvider>,
		);
		expect(markup).toContain("Usage");
		expect(markup).toContain("1.5 GB");
		expect(markup).toContain("↑ 1 MB/s · ↓ 2 MB/s");

		const empty = renderToStaticMarkup(
			<ColorModeProvider>
				<ResourceSummaryPills items={[]} />
			</ColorModeProvider>,
		);
		expect(empty).not.toContain("Usage");
	});
});
