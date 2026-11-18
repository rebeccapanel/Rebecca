import { describe, expect, it } from "vitest";

import { looksLikeWireguard, normalizeWireguardKey, parseWireguardImport } from "./wireguardImport";

const PRIV = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=";
const PUB = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=";
const PSK = "FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE=";

const ok = (input: string) => {
	const result = parseWireguardImport(input);
	if (!result || !result.ok) throw new Error(`not parsed: ${JSON.stringify(result)}`);
	return result;
};

describe("parseWireguardImport", () => {
	it("reads a standard .conf with interface and peer", () => {
		const { outbound, warnings } = ok(
			[
				"[Interface]",
				`PrivateKey = ${PRIV}`,
				"Address = 10.5.0.2/16, fd00::2/128",
				"DNS = 1.1.1.1",
				"MTU = 1280",
				"",
				"[Peer]",
				`PublicKey = ${PUB}`,
				`PresharedKey = ${PSK}`,
				"AllowedIPs = 0.0.0.0/0, ::/0",
				"Endpoint = 217.138.198.246:51820",
				"PersistentKeepalive = 25",
			].join("\n"),
		);
		expect(warnings).toEqual([]);
		expect(outbound.protocol).toBe("wireguard");
		expect(outbound.settings).toEqual({
			secretKey: PRIV,
			address: ["10.5.0.2/16", "fd00::2/128"],
			mtu: 1280,
			peers: [{ publicKey: PUB, preSharedKey: PSK, allowedIPs: ["0.0.0.0/0", "::/0"], endpoint: "217.138.198.246:51820", keepAlive: 25 }],
		});
	});

	it("accepts lines without section headers and Windows line endings", () => {
		const { outbound } = ok(`PrivateKey = ${PRIV}\r\nAddress = 10.0.0.2/32\r\nPublicKey = ${PUB}\r\nEndpoint = [2001:db8::1]:51820\r\n`);
		expect(outbound.settings.secretKey).toBe(PRIV);
		expect(outbound.settings.peers[0].endpoint).toBe("[2001:db8::1]:51820");
		expect(outbound.settings.peers[0].allowedIPs).toEqual(["0.0.0.0/0", "::/0"]);
	});

	it("handles several peers, comments and mixed case keys", () => {
		const { outbound } = ok(
			[
				"# exported",
				"[interface]",
				`privatekey=${PRIV}`,
				"address=10.0.0.2/32",
				"[peer]",
				`publickey=${PUB}`,
				"endpoint=a.example.com:51820",
				"; second",
				"[peer]",
				`PublicKey = ${PSK}`,
				"Endpoint = b.example.com:51821",
			].join("\n"),
		);
		expect(outbound.settings.peers.map((peer) => peer.endpoint)).toEqual(["a.example.com:51820", "b.example.com:51821"]);
	});

	it("reads Reserved as numbers or as a 3 byte base64 value", () => {
		const base = `[Interface]\nPrivateKey = ${PRIV}\nAddress = 10.0.0.2/32\n`;
		const peer = `\n[Peer]\nPublicKey = ${PUB}\nEndpoint = h.example.com:1\n`;
		expect(ok(`${base}Reserved = 12, 34, 56${peer}`).outbound.settings.reserved).toEqual([12, 34, 56]);
		expect(ok(`${base}Reserved = ${btoa(String.fromCharCode(1, 2, 3))}${peer}`).outbound.settings.reserved).toEqual([1, 2, 3]);
	});

	it("reads a wireguard:// link with url encoded keys and a fragment name", () => {
		const link = `wireguard://${encodeURIComponent(PRIV)}@engage.cloudflareclient.com:2408?address=172.16.0.2%2F32%2C2606%3A4700%3A110%3A8a36%3A%3A1%2F128&publickey=${encodeURIComponent(PUB)}&mtu=1280&reserved=1%2C2%2C3&keepalive=20#my%20warp`;
		const { outbound } = ok(link);
		expect(outbound.tag).toBe("my warp");
		expect(outbound.settings.secretKey).toBe(PRIV);
		expect(outbound.settings.address).toEqual(["172.16.0.2/32", "2606:4700:110:8a36::1/128"]);
		expect(outbound.settings.reserved).toEqual([1, 2, 3]);
		expect(outbound.settings.mtu).toBe(1280);
		expect(outbound.settings.peers[0]).toMatchObject({ publicKey: PUB, endpoint: "engage.cloudflareclient.com:2408", keepAlive: 20 });
	});

	it("keeps plus signs of a raw key inside a wireguard:// link", () => {
		const { outbound } = ok(`wg://${PRIV}@1.2.3.4:51820?publickey=${PUB}&address=10.0.0.2/32`);
		expect(outbound.settings.secretKey).toBe(PRIV);
		expect(outbound.settings.peers[0].publicKey).toBe(PUB);
	});

	it("reads an Xray outbound JSON whose keys still carry pasted conf labels", () => {
		const { outbound } = ok(
			JSON.stringify({
				tag: "usa 1",
				protocol: "wireguard",
				settings: {
					secretKey: `PrivateKey = ${PRIV}`,
					address: ["10.5.0.2/16"],
					peers: [{ publicKey: `PublicKey = ${PUB}`, endpoint: " 217.138.198.246:51820" }],
				},
			}),
		);
		expect(outbound.tag).toBe("usa 1");
		expect(outbound.settings.secretKey).toBe(PRIV);
		expect(outbound.settings.peers[0].publicKey).toBe(PUB);
		expect(outbound.settings.peers[0].endpoint).toBe("217.138.198.246:51820");
	});

	it("reads a sing-box wireguard endpoint", () => {
		const { outbound } = ok(
			JSON.stringify({
				endpoints: [
					{
						type: "wireguard",
						tag: "wg-out",
						address: ["10.0.0.2/32"],
						private_key: PRIV,
						mtu: 1408,
						peers: [{ address: "203.0.113.5", port: 51820, public_key: PUB, pre_shared_key: PSK, allowed_ips: ["0.0.0.0/0"], reserved: [1, 2, 3] }],
					},
				],
			}),
		);
		expect(outbound.tag).toBe("wg-out");
		expect(outbound.settings.mtu).toBe(1408);
		expect(outbound.settings.peers[0]).toMatchObject({ publicKey: PUB, preSharedKey: PSK, endpoint: "203.0.113.5:51820", allowedIPs: ["0.0.0.0/0"] });
	});

	it("reads a Mihomo wireguard proxy", () => {
		const { outbound } = ok(
			[
				"proxies:",
				"  - name: warp",
				"    type: wireguard",
				"    server: engage.cloudflareclient.com",
				"    port: 2408",
				"    ip: 172.16.0.2",
				`    private-key: ${PRIV}`,
				`    public-key: ${PUB}`,
				"    reserved: [1, 2, 3]",
				"    mtu: 1280",
			].join("\n"),
		);
		expect(outbound.tag).toBe("warp");
		expect(outbound.settings.address).toEqual(["172.16.0.2/32"]);
		expect(outbound.settings.reserved).toEqual([1, 2, 3]);
		expect(outbound.settings.peers[0]).toMatchObject({ publicKey: PUB, endpoint: "engage.cloudflareclient.com:2408" });
	});

	it("converts url safe base64 keys to the standard form", () => {
		const urlSafe = PRIV.replace(/\+/g, "-").replace(/\//g, "_");
		expect(normalizeWireguardKey(urlSafe)).toBe(PRIV);
		expect(normalizeWireguardKey(`  "${PRIV}"  `)).toBe(PRIV);
	});

	it("rejects broken keys with a clear error instead of passing them on", () => {
		const result = parseWireguardImport(`[Interface]\nPrivateKey = not-a-key\n[Peer]\nPublicKey = ${PUB}\nEndpoint = 1.2.3.4:1`);
		expect(result).toMatchObject({ ok: false });
		const noPeer = parseWireguardImport(`[Interface]\nPrivateKey = ${PRIV}\nAddress = 10.0.0.2/32`);
		expect(noPeer).toMatchObject({ ok: false });
	});

	it("ignores text that is not WireGuard", () => {
		expect(parseWireguardImport("vless://uuid@example.com:443?security=tls#x")).toBeNull();
		expect(looksLikeWireguard("hello")).toBe(false);
		expect(parseWireguardImport("")).toBeNull();
	});
});
