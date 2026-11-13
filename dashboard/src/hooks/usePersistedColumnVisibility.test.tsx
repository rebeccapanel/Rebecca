import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePersistedColumnVisibility } from "./usePersistedColumnVisibility";

Object.assign(globalThis, { React });

const stubStorage = (initial: Record<string, string>) => {
	const data = new Map(Object.entries(initial));
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
};

const Probe = ({ name }: { name: string }) => (
	<>{JSON.stringify(usePersistedColumnVisibility(name)[0])}</>
);

describe("usePersistedColumnVisibility", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("restores the saved columns of that table only", () => {
		stubStorage({ "rebecca-columns-admins": '{"status":false}' });
		expect(renderToStaticMarkup(<Probe name="admins" />)).toBe('{"status":false}'.replace(/"/g, "&quot;"));
		expect(renderToStaticMarkup(<Probe name="users" />)).toBe("{}");
	});

	it("ignores corrupt stored values", () => {
		stubStorage({ "rebecca-columns-admins": "not json" });
		expect(renderToStaticMarkup(<Probe name="admins" />)).toBe("{}");
	});
});
