import { describe, expect, it } from "vitest";

import { formValuesToRule, type RoutingRule, ruleToFormValues } from "./RuleModal";

describe("routing rule form", () => {
	it("keeps every Xray rule field through an edit round trip", () => {
		const rule: RoutingRule = {
			type: "field",
			inboundTag: ["in"],
			network: ["tcp", "udp"],
			source: ["10.0.0.0/8"],
			sourcePort: ["1000-2000"],
			localIP: ["127.0.0.1", "geoip:private"],
			localPort: "443,8443",
			domain: ["domain:example.com", "geosite:cn"],
			ip: ["geoip:private"],
			port: "80, 443",
			process: ["self/", "curl"],
			vlessRoute: "53,443,1000-2000",
			ruleTag: "block-ads",
			webhook: {
				url: "https://hooks.example.com/rule",
				deduplication: 300,
				headers: { "X-Key": "secret" },
			},
			outboundTag: "direct",
		};
		expect(formValuesToRule(ruleToFormValues(rule))).toEqual(rule);
	});

	it("omits the webhook when no URL is set", () => {
		const values = ruleToFormValues({ outboundTag: "direct" });
		values.webhookDeduplication = "10";
		expect(formValuesToRule(values)).toEqual({ type: "field", outboundTag: "direct" });
	});
});
