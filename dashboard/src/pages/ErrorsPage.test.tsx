import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { useSystemDiagnostics } from "components/SystemDiagnostics";
import useGetUser from "hooks/useGetUser";
import { useAPIRequestErrors } from "service/http";
import { AdminRole } from "types/Admin";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorsPage from "./ErrorsPage";

Object.assign(globalThis, { React });
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", dir: () => "ltr" },
	}),
}));
vi.mock("hooks/useGetUser", () => ({ default: vi.fn() }));
vi.mock("components/SystemDiagnostics", async () => ({
	...(await vi.importActual<typeof import("components/SystemDiagnostics")>(
		"components/SystemDiagnostics",
	)),
	useSystemDiagnostics: vi.fn(),
}));

const render = () =>
	renderToStaticMarkup(
		<ColorModeProvider>
			<StaticRouter basename="/dashboard" location="/dashboard/errors">
				<ErrorsPage />
			</StaticRouter>
		</ColorModeProvider>,
	);

describe("errors page", () => {
	afterEach(() => {
		useAPIRequestErrors.getState().clear();
		vi.clearAllMocks();
	});
	it("shows all levels in severity order and request details with their original target link", () => {
		vi.mocked(useGetUser).mockReturnValue({
			userData: { role: AdminRole.FullAccess },
		} as any);
		vi.mocked(useSystemDiagnostics).mockReturnValue({
			data: [
				{
					target_id: "master",
					resource_type: "runtime_warning",
					resource: "Runtime",
					message: "warning-detail",
				},
				{
					target_id: "master",
					resource_type: "backup",
					resource: "Backup",
					message: "backup-detail",
				},
				{
					target_id: "node:7",
					resource_type: "node_service",
					resource: "xray",
					severity: "critical",
					message: "stopped-core-detail",
				},
			],
			refetch: vi.fn(),
		} as any);
		useAPIRequestErrors.setState({
			errors: [
				{
					key: "POST /panel/xray/testOutbound",
					message: "request-detail",
					href: "/xray-settings?target=node%3A7#outbounds",
				},
			],
		});
		const html = render();
		for (const text of [
			"diagnostics.menu",
			"stopped-core-detail",
			"backup-detail",
			"warning-detail",
			"request-detail",
			"diagnostics.level.critical",
			"diagnostics.level.error",
			"diagnostics.level.warning",
		])
			expect(html).toContain(text);
		expect(html.indexOf("stopped-core-detail")).toBeLessThan(
			html.indexOf("backup-detail"),
		);
		expect(html.indexOf("backup-detail")).toBeLessThan(
			html.indexOf("warning-detail"),
		);
		expect(html).toContain(
			'href="/dashboard/xray-settings?target=node%3A7#outbounds"',
		);
		expect(useSystemDiagnostics).toHaveBeenCalledWith(true);
	});
	it("does not expose cached global diagnostics to an ordinary admin", () => {
		vi.mocked(useGetUser).mockReturnValue({
			userData: { role: AdminRole.Standard },
		} as any);
		vi.mocked(useSystemDiagnostics).mockReturnValue({
			data: [
				{
					target_id: "master",
					resource_type: "database",
					resource: "users",
					message: "private-server-detail",
				},
			],
		} as any);
		useAPIRequestErrors.setState({
			errors: [{ key: "GET /users", message: "own-request-detail" }],
		});
		const html = render();
		expect(html).not.toContain("private-server-detail");
		expect(html).toContain("own-request-detail");
		expect(useSystemDiagnostics).toHaveBeenCalledWith(false);
	});
});
