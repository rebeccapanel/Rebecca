import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HostClientSettingsEditor } from "./HostClientSettingsEditor";

Object.assign(globalThis, { React });
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("HostClientSettingsEditor", () => {
	it("shows per-host ECH controls for TLS only", () => {
		const render = (usesTLS: boolean) => renderToStaticMarkup(React.createElement(ColorModeProvider, null,
			React.createElement(HostClientSettingsEditor, { value: '{"tlsSettings":{"echConfigList":"cloudflare-ech.com+udp://1.1.1.1"}}', onChange: () => undefined, usesTLS, protocol: "vless", network: "ws" })));
		expect(render(true)).toContain("ECH Config List");
		expect(render(true)).toContain('value="cloudflare-ech.com+udp://1.1.1.1"');
		expect(render(false)).not.toContain("ECH Config List");
	});
	it("keeps malformed JSON editable without crashing", () => {
		const html = renderToStaticMarkup(React.createElement(ColorModeProvider, null,
			React.createElement(HostClientSettingsEditor, { value: "{", onChange: () => undefined, usesTLS: true })));
		expect(html).toContain("hostsDialog.clientSettingsJSON");
		expect(html).toContain("disabled");
	});
});
