import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Clock, CircleAlert, Ban, Wifi } from "lucide-react";

import type { ComponentType } from "react";
import type { DataLimitResetStrategy } from "types/User";

const ActiveStatusIcon = withClass(Wifi, "[stroke-width:2px] w-4 h-4");
const DisabledStatusIcon = withClass(Ban, "[stroke-width:2px] w-4 h-4");
const LimitedStatusIcon = withClass(CircleAlert, "[stroke-width:2px] w-4 h-4");
const ExpiredStatusIcon = withClass(Clock, "[stroke-width:2px] w-4 h-4");
const On_holdStatusIcon = withClass(Clock, "[stroke-width:2px] w-4 h-4");

export const resetStrategy: { title: string; value: DataLimitResetStrategy }[] =
	[
		{
			title: "No",
			value: "no_reset",
		},
		{
			title: "Daily",
			value: "day",
		},
		{
			title: "Weekly",
			value: "week",
		},
		{
			title: "Monthly",
			value: "month",
		},
		{
			title: "Annually",
			value: "year",
		},
	];

export const statusColors: {
	[key: string]: {
		statusColor: string;
		bandWidthColor: string;
		icon: ComponentType<{ className?: string }>;
	};
} = {
	active: {
		statusColor: "green",
		bandWidthColor: "primary",
		icon: ActiveStatusIcon,
	},
	connected: {
		statusColor: "green",
		bandWidthColor: "primary",
		icon: ActiveStatusIcon,
	},
	disabled: {
		statusColor: "gray",
		bandWidthColor: "gray",
		icon: DisabledStatusIcon,
	},
	expired: {
		statusColor: "orange",
		bandWidthColor: "orange",
		icon: ExpiredStatusIcon,
	},
	on_hold: {
		statusColor: "purple",
		bandWidthColor: "purple",
		icon: On_holdStatusIcon,
	},
	connecting: {
		statusColor: "orange",
		bandWidthColor: "orange",
		icon: ExpiredStatusIcon,
	},
	limited: {
		statusColor: "red",
		bandWidthColor: "red",
		icon: LimitedStatusIcon,
	},
	error: {
		statusColor: "red",
		bandWidthColor: "red",
		icon: LimitedStatusIcon,
	},
	deleted: {
		statusColor: "gray",
		bandWidthColor: "gray",
		icon: DisabledStatusIcon,
	},
};
