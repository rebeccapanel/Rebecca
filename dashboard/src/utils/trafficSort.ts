export type TrafficSortOrder = "default" | "lowest" | "highest";

export const sortByTraffic = <T>(
	items: T[],
	order: TrafficSortOrder,
	getTotal: (item: T) => number,
) => {
	if (order === "default") return items;
	const direction = order === "lowest" ? 1 : -1;
	return [...items].sort((left, right) => {
		const leftTotal = Math.max(0, Number(getTotal(left)) || 0);
		const rightTotal = Math.max(0, Number(getTotal(right)) || 0);
		return (leftTotal - rightTotal) * direction;
	});
};
