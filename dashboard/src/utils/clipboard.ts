const legacyCopy = (text: string): boolean => {
	const active = document.activeElement;
	const host =
		active instanceof HTMLElement
			? (active.closest<HTMLElement>('[role="dialog"]') ?? document.body)
			: document.body;
	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.setAttribute("readonly", "");
	textArea.style.position = "fixed";
	textArea.style.opacity = "0";
	textArea.style.pointerEvents = "none";
	host.appendChild(textArea);
	textArea.focus();
	textArea.select();
	try {
		return document.execCommand("copy");
	} finally {
		host.removeChild(textArea);
		if (active instanceof HTMLElement) active.focus();
	}
};

export const copyTextToClipboard = async (text: string): Promise<void> => {
	if (!text) return;
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {}
	}
	if (!legacyCopy(text)) throw new Error("copy failed");
};
