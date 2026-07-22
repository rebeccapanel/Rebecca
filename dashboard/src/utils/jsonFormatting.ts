type JsonObject = Record<string, unknown>;

export type RebeccaJsonContext =
	| "config"
	| "inbounds"
	| "inbound"
	| "outbounds"
	| "outbound"
	| "routing"
	| "routingRules"
	| "routingRule";

const isPlainObject = (value: unknown): value is JsonObject =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value);

const orderKeys = (object: JsonObject, preferred: string[]) => {
	const keys = Object.keys(object);
	const preferredSet = new Set(preferred);
	return [
		...preferred.filter((key) => Object.hasOwn(object, key)),
		...keys.filter((key) => !preferredSet.has(key)),
	];
};

const orderKeysWithTail = (
	object: JsonObject,
	preferredHead: string[],
	preferredTail: string[],
) => {
	const keys = Object.keys(object);
	const fixedSet = new Set([...preferredHead, ...preferredTail]);
	return [
		...preferredHead.filter((key) => Object.hasOwn(object, key)),
		...keys.filter((key) => !fixedSet.has(key)),
		...preferredTail.filter((key) => Object.hasOwn(object, key)),
	];
};

const childContextForKey = (key: string): RebeccaJsonContext | undefined => {
	switch (key) {
		case "inbounds":
			return "inbounds";
		case "outbounds":
			return "outbounds";
		case "routing":
			return "routing";
		case "rules":
			return "routingRules";
		default:
			return undefined;
	}
};

const keyOrderForObject = (
	object: JsonObject,
	context?: RebeccaJsonContext,
): string[] => {
	if (
		context === "config" ||
		(!context &&
			("inbounds" in object || "outbounds" in object || "routing" in object))
	) {
		return orderKeys(object, [
			"inbounds",
			"outbounds",
			"routing",
			"dns",
			"fakedns",
			"log",
			"api",
			"policy",
			"stats",
			"transport",
			"observatory",
			"burstObservatory",
		]);
	}

	if (context === "inbound") {
		return orderKeysWithTail(
			object,
			[
				"tag",
				"listen",
				"port",
				"protocol",
				"settings",
				"streamSettings",
				"allocate",
			],
			["sniffing"],
		);
	}

	if (context === "outbound") {
		return orderKeys(object, [
			"tag",
			"sendThrough",
			"protocol",
			"settings",
			"streamSettings",
			"proxySettings",
			"mux",
		]);
	}

	if (context === "routing") {
		return orderKeys(object, [
			"domainStrategy",
			"domainMatcher",
			"rules",
			"balancers",
		]);
	}

	if (context === "routingRule") {
		return orderKeys(object, [
			"type",
			"inboundTag",
			"outboundTag",
			"balancerTag",
			"domain",
			"ip",
			"port",
			"source",
			"sourcePort",
			"user",
			"protocol",
			"attrs",
		]);
	}

	return Object.keys(object);
};

export const canonicalizeRebeccaJson = (
	value: unknown,
	context?: RebeccaJsonContext,
): unknown => {
	if (Array.isArray(value)) {
		const itemContext =
			context === "inbounds"
				? "inbound"
				: context === "outbounds"
					? "outbound"
					: context === "routingRules"
						? "routingRule"
						: undefined;
		return value.map((item) => canonicalizeRebeccaJson(item, itemContext));
	}

	if (!isPlainObject(value)) {
		return value;
	}

	const ordered: JsonObject = {};
	for (const key of keyOrderForObject(value, context)) {
		const childContext = childContextForKey(key);
		ordered[key] = canonicalizeRebeccaJson(value[key], childContext);
	}
	return ordered;
};

export const stringifyRebeccaJson = (
	value: unknown,
	space: number | string = 2,
	context?: RebeccaJsonContext,
) => JSON.stringify(canonicalizeRebeccaJson(value, context), null, space);
