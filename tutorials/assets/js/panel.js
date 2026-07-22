(() => {
	const marker = "/tutorial-content/";
	const markerIndex = location.pathname.indexOf(marker);
	const panelRoot =
		markerIndex >= 0 ? location.pathname.slice(0, markerIndex) : "";
	const docsRoot = `${panelRoot}/tutorial-content`;
	const lang = document.documentElement.lang.startsWith("fa") ? "fa" : "en";
	const nativeFetch = window.fetch.bind(window);
	window.fetch = (input, options) => {
		if (
			typeof input === "string" &&
			/^\/(?:en|fa)\.search-data\.json$/.test(input)
		) {
			return nativeFetch(`${docsRoot}/${input.slice(1)}`, options);
		}
		return nativeFetch(input, options);
	};

	const version = document.querySelector(
		'meta[name="rb-tutorial-version"]',
	)?.content;
	if (version) localStorage.setItem(`rb-tutorials-seen-${lang}`, version);

	document.querySelectorAll("a[data-panel-route]").forEach((link) => {
		const route = link.dataset.panelRoute || "/";
		link.href = `${panelRoot}${route.startsWith("/") ? route : `/${route}`}`;
		link.target = "_top";
		link.addEventListener("click", () => {
			if (link.dataset.sessionKey) {
				sessionStorage.setItem(
					link.dataset.sessionKey,
					link.dataset.sessionValue || "true",
				);
			}
		});
	});

	document.querySelectorAll('a[href$="#panel"]').forEach((link) => {
		link.href = `${panelRoot}/`;
		link.target = "_top";
	});

	document.addEventListener("click", (event) => {
		const searchLink = event.target.closest(".hextra-search-results a");
		const searchPath = searchLink?.getAttribute("href");
		if (
			searchPath?.startsWith("/docs/") ||
			searchPath?.startsWith("/fa/docs/")
		) {
			event.preventDefault();
			location.assign(`${docsRoot}${searchPath}`);
		}
	});

	window.addEventListener("storage", (event) => {
		if (
			(event.key === "rb-theme" || event.key === "chakra-ui-color-mode") &&
			(event.newValue === "light" || event.newValue === "dark")
		) {
			localStorage.setItem("color-theme", event.newValue);
			setTheme(event.newValue);
		}
	});

	fetch("/api/auth/session", {
		cache: "no-store",
		credentials: "same-origin",
	})
		.then((response) => {
			if (response.status === 401 || response.status === 403) {
				window.top?.location.replace(`${panelRoot}/login`);
				return null;
			}
			return response.ok ? response.json() : null;
		})
		.then((session) => {
			if (!session || session.state !== "active") {
				window.top?.location.replace(`${panelRoot}/login`);
				return;
			}
			const admin = session.admin;
			const privileged = admin && ["sudo", "full_access"].includes(admin.role);
			document.documentElement.dataset.rbPrivileged = privileged
				? "true"
				: "false";
			if (
				document.documentElement.dataset.rbAdminPage === "true" &&
				!privileged
			) {
				location.replace(`${docsRoot}/${lang === "fa" ? "fa/" : ""}docs/`);
			}
		})
		.catch(() => {
			document.documentElement.dataset.rbPrivileged = "false";
			if (document.documentElement.dataset.rbAdminPage === "true") {
				location.replace(`${docsRoot}/${lang === "fa" ? "fa/" : ""}docs/`);
			}
		});
})();
