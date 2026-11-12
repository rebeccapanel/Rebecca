import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { describe, expect, it, vi } from "vitest";
import ServicesPage from "./ServicesPage";

vi.hoisted(() => {
	const store = new Map<string, string>();
	Object.assign(globalThis, {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, String(value)),
			removeItem: (key: string) => store.delete(key),
			clear: () => store.clear(),
		},
	});
});

Object.assign(globalThis, { React });
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", dir: () => "ltr" },
	}),
}));
vi.mock("hooks/useGetUser", () => ({ default: vi.fn() }));

const services = Array.from({ length: 20 }, (_, index) => ({
	id: index + 2,
	name: `service-${index + 2}`,
	description: null,
	used_traffic: 0,
	lifetime_used_traffic: 0,
	usage_coefficient: 1,
	host_count: 1,
	user_count: 0,
	has_hosts: true,
	broken: false,
}));

describe("services page", () => {
	it("renders one page of services with pagination for the full list", () => {
		vi.mocked(useGetUser).mockReturnValue({
			userData: { role: "full_access", permissions: { sections: { services: true } } },
			getUserIsSuccess: true,
		} as any);
		useServicesStore.setState({
			services,
			summaryServices: [{ ...services[0], id: 1, name: "VIP VPN1" }, ...services],
			total: 21,
		});

		const markup = renderToStaticMarkup(
			<ColorModeProvider>
				<StaticRouter location="/services">
					<ServicesPage />
				</StaticRouter>
			</ColorModeProvider>,
		);

		expect(markup).toContain("service-2");
		expect(markup).toContain("services.searchServices");
		expect(markup).toContain("rb-data-table-pagination");
	});
});
