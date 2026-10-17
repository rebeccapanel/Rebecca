type OutboundJson = Record<string, any>;

// Every Mullvad device gets an IPv6 address in this range.
const MULLVAD_ADDRESS = /^fc00:bbbb:bbbb:bb01:/i;

export const isMullvadOutbound = (outbound?: OutboundJson | null) =>
	outbound?.protocol === "wireguard" &&
	(/^mullvad/i.test(String(outbound.tag ?? "")) ||
		(Array.isArray(outbound.settings?.address) &&
			outbound.settings.address.some((item: unknown) =>
				MULLVAD_ADDRESS.test(String(item)),
			)));

// "Mullvad", then "Mullvad-1", "Mullvad-2", ...: the first name no outbound uses yet.
export const nextMullvadTag = (tags: string[]) => {
	const used = new Set(tags.map((tag) => tag.toLowerCase()));
	if (!used.has("mullvad")) return "Mullvad";
	let number = 1;
	while (used.has(`mullvad-${number}`)) number++;
	return `Mullvad-${number}`;
};

export type MullvadForm = {
	privateKey: string;
	address: string;
	publicKey: string;
	endpoint: string;
};

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const ENDPOINT_PATTERN = /^\S+:\d{1,5}$/;

const splitAddresses = (value: string) =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

// Reads the WireGuard file Mullvad gives for a device ([Interface] + one [Peer]).
export const parseMullvadConfig = (text: string): MullvadForm | null => {
	const read = (key: string) =>
		text.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.+?)[ \\t]*$`, "im"))?.[1] ??
		"";
	const form = {
		privateKey: read("PrivateKey"),
		address: read("Address"),
		publicKey: read("PublicKey"),
		endpoint: read("Endpoint"),
	};
	return form.privateKey && form.publicKey ? form : null;
};

export type MullvadServer = {
	name: string;
	country: string;
	form: MullvadForm;
};

// "us-dal-wg-001" -> "us"; "zz" (unknown region) when the name carries no country.
const countryOfServer = (name: string) =>
	name
		.replace(/^mullvad-/i, "")
		.match(/^([a-z]{2})(?:-[a-z]{3})?(?=[-\d]|$)/i)?.[1]
		.toLowerCase() ?? "zz";

const inflate = (raw: Uint8Array<ArrayBuffer>) =>
	new Response(
		new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
	).arrayBuffer();

// Reads every .conf of the "all servers" zip Mullvad offers for download.
export const readMullvadZip = async (
	data: ArrayBuffer,
): Promise<MullvadServer[]> => {
	const view = new DataView(data);
	const bytes = new Uint8Array(data);
	const decoder = new TextDecoder();
	// end of central directory record
	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
	if (end < 0) return [];

	const servers: MullvadServer[] = [];
	let entry = view.getUint32(end + 16, true);
	for (let left = view.getUint16(end + 10, true); left > 0; left--) {
		const method = view.getUint16(entry + 10, true);
		const size = view.getUint32(entry + 20, true);
		const pathLength = view.getUint16(entry + 28, true);
		const local = view.getUint32(entry + 42, true);
		const path = decoder.decode(bytes.subarray(entry + 46, entry + 46 + pathLength));
		entry +=
			46 +
			pathLength +
			view.getUint16(entry + 30, true) +
			view.getUint16(entry + 32, true);
		// 0 = stored, 8 = deflated
		if (!/\.conf$/i.test(path) || (method !== 0 && method !== 8)) continue;

		const start =
			local +
			30 +
			view.getUint16(local + 26, true) +
			view.getUint16(local + 28, true);
		const raw = bytes.subarray(start, start + size);
		const form = parseMullvadConfig(
			decoder.decode(method === 0 ? raw : await inflate(raw)),
		);
		if (!form) continue;
		const name = path.replace(/^.*\//, "").replace(/\.conf$/i, "");
		servers.push({ name, country: countryOfServer(name), form });
	}
	return servers.sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { numeric: true }),
	);
};

export const mullvadFormFromOutbound = (
	outbound?: OutboundJson | null,
): MullvadForm => {
	const settings = outbound?.settings ?? {};
	const peer = settings.peers?.[0] ?? {};
	return {
		privateKey: settings.secretKey ?? "",
		address: Array.isArray(settings.address) ? settings.address.join(", ") : "",
		publicKey: peer.publicKey ?? "",
		endpoint: peer.endpoint ?? "",
	};
};

export const isMullvadFormValid = (form: MullvadForm) =>
	KEY_PATTERN.test(form.privateKey.trim()) &&
	KEY_PATTERN.test(form.publicKey.trim()) &&
	ENDPOINT_PATTERN.test(form.endpoint.trim()) &&
	splitAddresses(form.address).length > 0;

export const buildMullvadOutbound = (
	tag: string,
	form: MullvadForm,
	previous?: OutboundJson | null,
): OutboundJson => ({
	...previous,
	tag: tag.trim(),
	protocol: "wireguard",
	settings: {
		domainStrategy: "ForceIP",
		...previous?.settings,
		secretKey: form.privateKey.trim(),
		address: splitAddresses(form.address),
		peers: [
			{
				...previous?.settings?.peers?.[0],
				publicKey: form.publicKey.trim(),
				endpoint: form.endpoint.trim(),
			},
		],
		noKernelTun: true,
	},
});
