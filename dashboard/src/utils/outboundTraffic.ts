export type OutboundTrafficRecord = {
	target_id?: string | null;
	outbound_id?: string | null;
	tag?: string | null;
	up?: number | string | null;
	down?: number | string | null;
};

export const sumOutboundTraffic = (
	records: OutboundTrafficRecord[],
	selectedTarget: string,
	outboundId: string | undefined,
	tag: string,
	aggregateTargets: boolean,
): { up: number; down: number } =>
	records.reduce<{ up: number; down: number }>(
		(total, record) => {
			const targetId = record.target_id || "master";
			const matchesTarget =
				Boolean(aggregateTargets && outboundId) || targetId === selectedTarget;
			const matchesOutbound = outboundId
				? record.outbound_id === outboundId
				: record.tag === tag;
			if (!matchesTarget || !matchesOutbound) return total;
			return {
				up: total.up + (Number(record.up) || 0),
				down: total.down + (Number(record.down) || 0),
			};
		},
		{ up: 0, down: 0 },
	);
