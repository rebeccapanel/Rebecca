import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { useAPIRequestErrors } from "service/http";
import {
	diagnosticHref,
	diagnosticSeverity,
	dashboardDiagnostics,
	requestErrorHref,
	type Diagnostic,
} from "utils/diagnostics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestErrors } from "./RequestErrors";
import { SystemDiagnostics } from "./SystemDiagnostics";

Object.assign(globalThis, { React });
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const render = (element: React.ReactElement) =>
	renderToStaticMarkup(
		<ColorModeProvider>
			<StaticRouter basename="/dashboard" location="/dashboard/">
				{element}
			</StaticRouter>
		</ColorModeProvider>,
	);

describe("dashboard diagnostic navigation", () => {
	afterEach(() => useAPIRequestErrors.getState().clear());

	it("renders every diagnostic as an internal link, including entries after the fifth", () => {
		const issues: Diagnostic[] = Array.from({ length: 8 }, (_, index) => ({
			target_id: "node:7",
			resource_type: "outbound",
			resource: `tor-${index}`,
			message: `native-service-failure-${index}`,
		}));
		const html = render(<SystemDiagnostics issues={issues} />);
		for (const issue of issues) expect(html).toContain(issue.message);
		expect(
			html.match(
				/href="\/dashboard\/xray-settings\?target=node%3A7#outbounds"/g,
			),
		).toHaveLength(8);
		expect(html).not.toContain("diagnostics.showAll");
	});

	it("keeps ordinary errors and warnings off the dashboard without hiding critical failures", () => {
		const issues: Diagnostic[] = [
			{
				target_id: "node:7",
				resource_type: "node_service",
				resource: "xray",
				severity: "critical",
				message: "core-start-failed",
			},
			{
				target_id: "master",
				resource_type: "backup",
				resource: "backup",
				message: "backup-delivery-failed",
			},
			{
				target_id: "master",
				resource_type: "runtime_warning",
				resource: "Runtime",
				message: "routine-warning",
			},
		];
		expect(issues.map(diagnosticSeverity)).toEqual([
			"critical",
			"error",
			"warning",
		]);
		expect(dashboardDiagnostics(issues)).toEqual([issues[0]]);
		const html = render(<SystemDiagnostics issues={issues} criticalOnly />);
		expect(html).toContain("core-start-failed");
		expect(html).toContain("diagnostics.level.critical");
		expect(html).not.toContain("backup-delivery-failed");
		expect(html).not.toContain("routine-warning");
		expect(
			dashboardDiagnostics([], {
				xray_running: true,
				last_xray_error: "old-node-error",
			}),
		).toEqual([]);
		expect(dashboardDiagnostics([], { xray_running: false })).toEqual([]);
		expect(
			dashboardDiagnostics([], {
				xray_running: false,
				last_xray_error: "core-failed",
			})[0].severity,
		).toBe("critical");
	});

	it("renders all request failures and keeps dismiss buttons outside navigation links", () => {
		useAPIRequestErrors.setState({
			errors: Array.from({ length: 6 }, (_, index) => ({
				key: `GET /inbounds/${index}`,
				message: `inbound-request-failure-${index}`,
			})),
		});
		const html = render(<RequestErrors />);
		for (let index = 0; index < 6; index++)
			expect(html).toContain(`inbound-request-failure-${index}`);
		expect(html.match(/href="\/dashboard\/hosts#inbounds"/g)).toHaveLength(6);
		const links = html.match(/<a\b[\s\S]*?<\/a>/g) || [];
		for (const link of links) expect(link).not.toContain("<button");
	});

	it("routes diagnostics and real API endpoints to their corresponding existing tabs", () => {
		for (const [kind, href] of [
			["inbound", "/hosts#inbounds"],
			["host", "/hosts#hosts"],
			["outbound", "/xray-settings?target=master#outbounds"],
			["outbound_subscription", "/xray-settings?target=master#outbounds"],
			["haproxy", "/haproxy"],
			["certificate", "/settings#ssl"],
			["telegram", "/settings#telegram"],
			["backup", "/settings#telegram?focus=periodic-backup"],
			["database", "/phpmyadmin"],
			["external_app", "/external-apps"],
		])
			expect(
				diagnosticHref({
					resource_type: kind,
					target_id: "master",
					resource: "test",
				}),
			).toBe(href);
		expect(requestErrorHref("POST /panel/xray/outboundHealth")).toBe(
			"/xray-settings#outbounds",
		);
		expect(requestErrorHref("POST /panel/xray/tor/setup")).toBe(
			"/xray-settings#outbounds",
		);
		expect(
			requestErrorHref("POST /panel/xray/testOutbound", "?target=node%3A7"),
		).toBe("/xray-settings?target=node%3A7#outbounds");
		expect(requestErrorHref("POST /settings/backup/import")).toBe("/");
		expect(requestErrorHref("STREAM /nodes/metrics")).toBe("/node-settings");
	});
});
