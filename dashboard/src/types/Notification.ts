export type NotificationItem = {
	id: number;
	kind: string;
	title: string;
	body: string;
	sender_username: string;
	created_at: number;
	read_at: number | null;
};

export type NotificationInbox = {
	items: NotificationItem[];
	unread: number;
	total: number;
};

export type SentNotification = {
	id: number;
	title: string;
	body: string;
	sender_username: string;
	created_at: number;
	recipients: number;
	read: number;
};

export type NotificationRecipient = {
	id: number;
	username: string;
	role: string;
};

export type NotificationRuleUnit = "percent" | "days" | "none";

export type NotificationRule = {
	key: string;
	enabled: boolean;
	threshold: number;
	title: string;
	body: string;
	unit: NotificationRuleUnit;
	recipients: "admin" | "operators";
	mandatory: boolean;
	default_enabled: boolean;
	default_threshold: number;
	default_title: string;
	default_body: string;
	placeholders: string[];
};

export type NotificationRuleUpdate = {
	enabled: boolean;
	threshold: number;
	title: string;
	body: string;
};
