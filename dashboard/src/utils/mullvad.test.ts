import { describe, expect, it } from "vitest";

import {
	buildMullvadOutbound,
	isMullvadFormValid,
	isMullvadOutbound,
	mullvadFormFromOutbound,
	nextMullvadTag,
	parseMullvadConfig,
	readMullvadZip,
} from "./mullvad";

const PRIVATE_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PUBLIC_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

const CONFIG = [
	"[Interface]",
	"# Device: Test Device",
	`PrivateKey = ${PRIVATE_KEY}`,
	"Address = 10.64.0.2/32,fc00:bbbb:bbbb:bb01::1:1/128",
	"DNS = 10.64.0.1",
	"",
	"[Peer]",
	`PublicKey = ${PUBLIC_KEY}`,
	"AllowedIPs = 0.0.0.0/0,::0/0",
	"Endpoint = 192.0.2.10:51820",
].join("\r\n");

const serverConfig = (endpoint: string) =>
	CONFIG.replace("192.0.2.10:51820", endpoint);

const deflate = async (data: Uint8Array<ArrayBuffer>) =>
	new Uint8Array(
		await new Response(
			new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw")),
		).arrayBuffer(),
	);

// Writes a zip the way archivers do: local headers, central directory, end record.
const makeZip = async (
	files: Array<{ path: string; text: string; stored?: boolean }>,
) => {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const path = encoder.encode(file.path);
		const plain = encoder.encode(file.text);
		const body = file.stored ? plain : await deflate(plain);
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(8, file.stored ? 0 : 8, true);
		local.setUint32(18, body.length, true);
		local.setUint32(22, plain.length, true);
		local.setUint16(26, path.length, true);
		const header = new DataView(new ArrayBuffer(46));
		header.setUint32(0, 0x02014b50, true);
		header.setUint16(10, file.stored ? 0 : 8, true);
		header.setUint32(20, body.length, true);
		header.setUint32(24, plain.length, true);
		header.setUint16(28, path.length, true);
		header.setUint32(42, offset, true);
		chunks.push(new Uint8Array(local.buffer), path, body);
		central.push(new Uint8Array(header.buffer), path);
		offset += 30 + path.length + body.length;
	}
	const centralSize = central.reduce((sum, part) => sum + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);
	return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[]).arrayBuffer();
};

describe("mullvad servers zip", () => {
	it("lists the servers of the zip with their country", async () => {
		const zip = await makeZip([
			{ path: "us-dal-wg-002.conf", text: serverConfig("198.51.100.2:51820") },
			{ path: "mullvad/de-fra-wg-010.conf", text: serverConfig("198.51.100.3:51820") },
			{ path: "us-dal-wg-001.conf", text: serverConfig("198.51.100.1:51820"), stored: true },
			{ path: "mullvad-se3.conf", text: serverConfig("198.51.100.4:51820") },
			{ path: "home.conf", text: serverConfig("198.51.100.5:51820") },
			{ path: "README.txt", text: "not a config" },
			{ path: "broken.conf", text: "[Interface]\n" },
		]);
		const servers = await readMullvadZip(zip);
		expect(servers.map((server) => [server.name, server.country])).toEqual([
			["de-fra-wg-010", "de"],
			["home", "zz"],
			["mullvad-se3", "se"],
			["us-dal-wg-001", "us"],
			["us-dal-wg-002", "us"],
		]);
		expect(servers[3].form).toEqual({
			privateKey: PRIVATE_KEY,
			address: "10.64.0.2/32,fc00:bbbb:bbbb:bb01::1:1/128",
			publicKey: PUBLIC_KEY,
			endpoint: "198.51.100.1:51820",
		});
	});

	it("finds nothing in a file that is not a zip", async () => {
		expect(await readMullvadZip(new TextEncoder().encode(CONFIG).buffer)).toEqual([]);
	});
});

describe("mullvad outbound names", () => {
	it("suggests Mullvad, then the first free Mullvad-N name", () => {
		expect(nextMullvadTag([])).toBe("Mullvad");
		expect(nextMullvadTag(["DIRECT", "mullvad", "warp"])).toBe("Mullvad-1");
		expect(nextMullvadTag(["Mullvad", "Mullvad-1", "MULLVAD-2", "Mullvad-4"])).toBe("Mullvad-3");
	});

	it("recognises Mullvad outbounds by name or by Mullvad's address range", () => {
		const wireguard = (tag: string, address: string[]) => ({
			tag,
			protocol: "wireguard",
			settings: { address },
		});
		expect(isMullvadOutbound(wireguard("Mullvad-2", ["10.64.0.2/32"]))).toBe(true);
		expect(
			isMullvadOutbound(wireguard("usa-exit", ["10.64.0.2/32", "fc00:bbbb:bbbb:bb01::1:1/128"])),
		).toBe(true);
		expect(isMullvadOutbound(wireguard("warp", ["172.16.0.2/32"]))).toBe(false);
		expect(isMullvadOutbound({ tag: "mullvad", protocol: "vless" })).toBe(false);
		expect(isMullvadOutbound(null)).toBe(false);
	});
});

describe("mullvad outbound", () => {
	it("reads the fields of a Mullvad WireGuard file", () => {
		expect(parseMullvadConfig(CONFIG)).toEqual({
			privateKey: PRIVATE_KEY,
			address: "10.64.0.2/32,fc00:bbbb:bbbb:bb01::1:1/128",
			publicKey: PUBLIC_KEY,
			endpoint: "192.0.2.10:51820",
		});
		expect(parseMullvadConfig("vless://example")).toBeNull();
	});

	it("builds a userspace WireGuard outbound", () => {
		const form = parseMullvadConfig(CONFIG);
		if (!form) throw new Error("config was not parsed");
		expect(isMullvadFormValid(form)).toBe(true);
		expect(buildMullvadOutbound(" Mullvad-1 ", form)).toEqual({
			tag: "Mullvad-1",
			protocol: "wireguard",
			settings: {
				domainStrategy: "ForceIP",
				secretKey: PRIVATE_KEY,
				address: ["10.64.0.2/32", "fc00:bbbb:bbbb:bb01::1:1/128"],
				peers: [{ publicKey: PUBLIC_KEY, endpoint: "192.0.2.10:51820" }],
				noKernelTun: true,
			},
		});
	});

	it("keeps extra settings of the outbound it replaces", () => {
		const form = parseMullvadConfig(CONFIG);
		if (!form) throw new Error("config was not parsed");
		const previous = {
			tag: "mullvad",
			protocol: "wireguard",
			streamSettings: { sockopt: { mark: 255 } },
			settings: {
				secretKey: "old",
				address: ["10.0.0.1/32"],
				mtu: 1380,
				domainStrategy: "ForceIPv4",
				peers: [{ publicKey: "old", endpoint: "198.51.100.1:51820", keepAlive: 25 }],
			},
		};
		const next = buildMullvadOutbound("mullvad", form, previous);
		expect(next.streamSettings).toEqual({ sockopt: { mark: 255 } });
		expect(next.settings.domainStrategy).toBe("ForceIPv4");
		expect(next.settings.mtu).toBe(1380);
		expect(next.settings.peers).toEqual([
			{ publicKey: PUBLIC_KEY, endpoint: "192.0.2.10:51820", keepAlive: 25 },
		]);
		expect(mullvadFormFromOutbound(next)).toEqual({
			...form,
			address: "10.64.0.2/32, fc00:bbbb:bbbb:bb01::1:1/128",
		});
	});

	it("rejects broken keys, endpoints and empty addresses", () => {
		const form = parseMullvadConfig(CONFIG);
		if (!form) throw new Error("config was not parsed");
		expect(isMullvadFormValid({ ...form, privateKey: "short" })).toBe(false);
		expect(isMullvadFormValid({ ...form, publicKey: `${PUBLIC_KEY}x` })).toBe(false);
		expect(isMullvadFormValid({ ...form, endpoint: "192.0.2.10" })).toBe(false);
		expect(isMullvadFormValid({ ...form, address: " , " })).toBe(false);
	});
});
