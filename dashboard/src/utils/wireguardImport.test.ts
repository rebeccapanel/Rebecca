import { describe, expect, it } from "vitest";

import { looksLikeWireguard, normalizeWireguardKey, parseWireguardImport, splitWireguardConfigs } from "./wireguardImport";

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
			remoteDNS: ["1.1.1.1"],
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

	it("maps DNS to remoteDNS and keeps only IP addresses", () => {
		const base = `[Interface]\nPrivateKey = ${PRIV}\nAddress = 10.0.0.2/32\n`;
		const peer = `\n[Peer]\nPublicKey = ${PUB}\nEndpoint = h.example.com:1\n`;
		expect(ok(`${base}DNS = 162.252.172.57, 149.154.159.92${peer}`).outbound.settings.remoteDNS).toEqual(["162.252.172.57", "149.154.159.92"]);
		expect(ok(`${base}DNS = 10.255.255.2, 2606:4700:4700::1111${peer}`).outbound.settings.remoteDNS).toEqual(["10.255.255.2", "2606:4700:4700::1111"]);
		const mixed = ok(`${base}DNS = 1.1.1.1, dns.example.com${peer}`);
		expect(mixed.outbound.settings.remoteDNS).toEqual(["1.1.1.1"]);
		expect(mixed.warnings.join(" ")).toMatch(/not IP addresses/);
		const none = ok(`${base}DNS = dns.example.com${peer}`);
		expect(none.outbound.settings.remoteDNS).toBeUndefined();
		expect(ok(`${base}${peer}`).outbound.settings.remoteDNS).toBeUndefined();
	});

	it("keeps remoteDNS, noKernelTun, workers and domainStrategy from an Xray outbound JSON", () => {
		const { outbound } = ok(
			JSON.stringify({
				protocol: "wireguard",
				settings: {
					secretKey: PRIV,
					address: ["10.0.0.2/32"],
					remoteDNS: ["1.1.1.1", "1.0.0.1"],
					noKernelTun: true,
					workers: 4,
					domainStrategy: "ForceIPv4",
					peers: [{ publicKey: PUB, endpoint: "h.example.com:1" }],
				},
			}),
		);
		expect(outbound.settings).toMatchObject({ remoteDNS: ["1.1.1.1", "1.0.0.1"], noKernelTun: true, workers: 4, domainStrategy: "ForceIPv4" });
		const bad = ok(JSON.stringify({ protocol: "wireguard", settings: { secretKey: PRIV, domainStrategy: "nope", peers: [{ publicKey: PUB, endpoint: "h:1" }] } }));
		expect(bad.outbound.settings.domainStrategy).toBeUndefined();
		expect(bad.outbound.settings.noKernelTun).toBeUndefined();
	});

	it("reads dns from a wireguard:// link and a Mihomo proxy", () => {
		const link = `wg://${PRIV}@1.2.3.4:51820?publickey=${PUB}&address=10.0.0.2/32&dns=1.1.1.1,8.8.8.8`;
		expect(ok(link).outbound.settings.remoteDNS).toEqual(["1.1.1.1", "8.8.8.8"]);
		const yaml = ["proxies:", "  - name: w", "    type: wireguard", "    server: h.example.com", "    port: 1", "    ip: 10.0.0.2", `    private-key: ${PRIV}`, `    public-key: ${PUB}`, "    dns: [1.1.1.1, 9.9.9.9]"].join("\n");
		expect(ok(yaml).outbound.settings.remoteDNS).toEqual(["1.1.1.1", "9.9.9.9"]);
	});

	it("splits several pasted configs that carry labels and comment banners", () => {
		const block = (priv: string, address: string, dns: string, endpoint: string) =>
			`[Interface]\nPrivateKey = ${priv}\nAddress = ${address}\nDNS = ${dns}\n\n[Peer]\nPublicKey = ${PUB}\nAllowedIPs = 0.0.0.0/0\nEndpoint = ${endpoint}\n`;
		const text = [
			"\u20aa LABEL:",
			block(PRIV, "10.101.231.72/32", "10.100.0.1", "91.132.92.113:250"),
			"#\n# Use this configuration with WireGuard client\n#",
			block(PRIV, "10.14.0.2/16", "162.252.172.57, 149.154.159.92", "al-tia.prod.surfshark.com:51820"),
			block(PRIV, "100.101.194.50/32, fd54:4::e0ca:f7f5:d887:e824/128", "10.255.255.2", "tia-283-wg.whiskergalaxy.com:65142"),
		].join("\n");
		const parts = splitWireguardConfigs(text);
		expect(parts).toHaveLength(3);
		const results = parts.map((part) => ok(part).outbound.settings);
		expect(results.map((item) => item.peers[0].endpoint)).toEqual(["91.132.92.113:250", "al-tia.prod.surfshark.com:51820", "tia-283-wg.whiskergalaxy.com:65142"]);
		expect(results.map((item) => item.remoteDNS)).toEqual([["10.100.0.1"], ["162.252.172.57", "149.154.159.92"], ["10.255.255.2"]]);
		expect(results[2].address).toEqual(["100.101.194.50/32", "fd54:4::e0ca:f7f5:d887:e824/128"]);
		expect(splitWireguardConfigs(`[Interface]\nPrivateKey = ${PRIV}`)).toHaveLength(1);
		expect(splitWireguardConfigs("wg://x@1.2.3.4:1")).toEqual(["wg://x@1.2.3.4:1"]);
	});
});
