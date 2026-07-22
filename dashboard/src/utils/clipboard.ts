export const copyTextToClipboard = async (text: string): Promise<void> => {
	if (!text) return;
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.setAttribute("readonly", "");
	textArea.style.position = "fixed";
	textArea.style.opacity = "0";
	textArea.style.pointerEvents = "none";
	document.body.appendChild(textArea);
	textArea.select();
	try {
		document.execCommand("copy");
	} finally {
		document.body.removeChild(textArea);
	}
};
