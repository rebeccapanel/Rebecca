import type { User, UserListItem } from "types/User";

type GenerateUserLinksOptions = {
	includeInactive?: boolean;
};

export const generateUserLinks = (
	user: User | UserListItem,
	linkTemplates?: Record<string, string[]>,
	options: GenerateUserLinksOptions = {},
): string[] => {
	const allowLinks =
		(user as User).link_data &&
		linkTemplates &&
		(options.includeInactive || user.status === "active");
	if (allowLinks) {
		const linkDataList = (user as User).link_data;
		let dataIndex = 0;
		const links: string[] = [];

		for (const [protocol, templates] of Object.entries(linkTemplates)) {
			for (const template of templates) {
				if (!linkDataList || dataIndex >= linkDataList.length) {
					continue;
				}

				const linkData = linkDataList[dataIndex];

				if (linkData.protocol === protocol) {
					let link = template;

					if (linkData.uuid) {
						link = link.replace(/{UUID}/g, linkData.uuid);
					} else if (linkData.password) {
						link = link.replace(
							/{PASSWORD}/g,
							encodeURIComponent(linkData.password),
						);
					} else if (linkData.password_b64) {
						link = link.replace(/{PASSWORD_B64}/g, linkData.password_b64);
					}

					links.push(link);
					dataIndex++;
				}
			}
		}

		if (links.length > 0) {
			return links;
		}
	}

	const legacyLinks = (user as Partial<User>).links;
	return legacyLinks || [];
};
