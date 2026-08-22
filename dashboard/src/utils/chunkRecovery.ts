const chunkRecoveryKey = "rebecca:chunk-recovery";
const chunkRecoveryCooldownMs = 60_000;

const chunkLoadErrorPatterns = [
	/failed to fetch dynamically imported module/i,
	/error loading dynamically imported module/i,
	/importing a module script failed/i,
	/loading chunk .+ failed/i,
	/chunkloaderror/i,
];

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error ?? "");

export const isChunkLoadError = (error: unknown) =>
	chunkLoadErrorPatterns.some((pattern) => pattern.test(errorMessage(error)));

export const recoverFromStaleChunk = (
	error: unknown,
	options: {
		storage?: Pick<Storage, "getItem" | "setItem">;
		reload?: () => void;
		now?: number;
	} = {},
) => {
	if (!isChunkLoadError(error)) return false;

	const storage = options.storage ?? window.sessionStorage;
	const reload = options.reload ?? (() => window.location.reload());
	const now = options.now ?? Date.now();
	const message = errorMessage(error);

	try {
		const previous = storage.getItem(chunkRecoveryKey) ?? "";
		const separator = previous.indexOf("\n");
		const previousAt = Number(previous.slice(0, separator));
		const previousMessage = previous.slice(separator + 1);
		if (
			previousMessage === message &&
			Number.isFinite(previousAt) &&
			now - previousAt < chunkRecoveryCooldownMs
		) {
			return false;
		}
		storage.setItem(chunkRecoveryKey, `${now}\n${message}`);
	} catch {
		return false;
	}

	reload();
	return true;
};
