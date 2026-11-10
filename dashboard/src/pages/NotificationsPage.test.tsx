import { ColorModeProvider } from "lib/color-mode";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import useGetUser from "hooks/useGetUser";
import { AdminRole } from "types/Admin";
import { describe, expect, it, vi } from "vitest";
import NotificationsPage from "./NotificationsPage";

Object.assign(globalThis, { React });
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", dir: () => "ltr" },
	}),
}));
vi.mock("hooks/useGetUser", () => ({ default: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(() => ({ data: undefined })),
	useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
	useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

const render = (role: AdminRole) => {
	vi.mocked(useGetUser).mockReturnValue({
		userData: { role },
	} as any);
	return renderToStaticMarkup(
		<ColorModeProvider>
			<StaticRouter basename="/dashboard" location="/dashboard/notifications">
				<NotificationsPage />
			</StaticRouter>
		</ColorModeProvider>,
	);
};

describe("notifications page", () => {
	it("shows only the inbox to standard admins", () => {
		const markup = render(AdminRole.Standard);
		expect(markup).toContain("notifications.tabs.inbox");
		expect(markup).not.toContain("notifications.tabs.send");
		expect(markup).not.toContain("notifications.tabs.rules");
	});

	it("offers browser notifications to every admin", () => {
		for (const role of [AdminRole.Standard, AdminRole.Sudo, AdminRole.FullAccess]) {
			expect(render(role)).toContain("notifications.push.title");
		}
	});

	it("adds sending for sudo admins without automatic rules", () => {
		const markup = render(AdminRole.Sudo);
		expect(markup).toContain("notifications.tabs.send");
		expect(markup).not.toContain("notifications.tabs.rules");
	});

	it("shows sending and automatic rules to full access admins", () => {
		const markup = render(AdminRole.FullAccess);
		expect(markup).toContain("notifications.tabs.send");
		expect(markup).toContain("notifications.tabs.rules");
	});
});
