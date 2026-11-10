import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Field, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "components/ui/radio-group";
import { Checkbox } from "components/ui/checkbox";
import { Switch } from "components/ui/switch";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { cn } from "lib/cn";
import dayjs from "dayjs";
import { BrowserNotificationsCard } from "components/BrowserNotificationsCard";
import { PageHeader, TabSystem } from "components/ui";
import useGetUser from "hooks/useGetUser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAPIErrorMessage } from "service/http";
import {
	getNotificationRecipients,
	getNotificationRules,
	getNotifications,
	getSentNotifications,
	markNotificationsRead,
	sendNotification,
	updateNotificationRule,
} from "service/notifications";
import { AdminRole } from "types/Admin";
import type { NotificationRule } from "types/Notification";

const formatTime = (unix: number) =>
	dayjs.unix(unix).format("YYYY-MM-DD HH:mm");

const InboxPanel = () => {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const inbox = useQuery({ queryKey: ["notifications", "inbox"], queryFn: () =>
		getNotifications({ limit: 100 }) });
	const markAll = useMutation({ mutationFn: () => markNotificationsRead({ all: true }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }), });
	const markOne = useMutation({ mutationFn: (id: number) => markNotificationsRead({ ids: [id] }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }), });
	const items = inbox.data?.items ?? [];

	return (
		<div className="flex flex-col gap-4">
			<BrowserNotificationsCard />
			<div className="flex flex-row items-center gap-2 justify-between">
				<p className="text-gray-500 text-[0.875rem]">
					{t("notifications.inbox.summary", {
						unread: inbox.data?.unread ?? 0,
						total: inbox.data?.total ?? 0,
					})}
				</p>
				<Button disabled={!inbox.data?.unread} onClick={() => markAll.mutate()} variant="outline" size="sm" loading={markAll.isPending}>
					{t("notifications.inbox.markAllRead")}
				</Button>
			</div>
			{items.length === 0 && (
				<p className="text-gray-500">{t("notifications.inbox.empty")}</p>
			)}
			{items.map((item) => (
				<div key={item.id} className={cn("p-4 rounded-md border", item.read_at === null ? "border-blue-400!" : "")}>
					<div className="flex flex-row gap-2 justify-between items-start mb-1">
						<div className="flex flex-row items-center gap-2">
							<p className="font-semibold">{item.title}</p>
							{item.read_at === null && (
								<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
									{t("notifications.inbox.unread")}
								</Badge>
							)}
						</div>
						<p className="text-[0.75rem] text-gray-500 whitespace-nowrap">
							{formatTime(item.created_at)}
						</p>
					</div>
					<p className="whitespace-pre-wrap text-[0.875rem]">
						{item.body}
					</p>
					<div className="flex flex-row items-center gap-2 justify-between mt-2">
						<p className="text-[0.75rem] text-gray-500">
							{t("notifications.inbox.from", {
								sender: item.sender_username,
							})}
						</p>
						{item.read_at === null && (
							<Button onClick={() => markOne.mutate(item.id)} variant="ghost" size="xs">
								{t("notifications.inbox.markRead")}
							</Button>
						)}
					</div>
				</div>
			))}
		</div>
	);
};

const SendPanel = () => {
	const { t } = useTranslation();
	
	const queryClient = useQueryClient();
	const recipients = useQuery({ queryKey: ["notifications", "recipients"], queryFn: () =>
		getNotificationRecipients() });
	const sent = useQuery({ queryKey: ["notifications", "sent"], queryFn: () =>
		getSentNotifications() });
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [audience, setAudience] = useState<"all" | "selected">("all");
	const [selected, setSelected] = useState<number[]>([]);
	const mutation = useMutation({ mutationFn: sendNotification, onSuccess: (result) => {
			toast.success(t("notifications.send.sent", { count: result.recipients }));
			setTitle("");
			setBody("");
			setSelected([]);
			queryClient.invalidateQueries({ queryKey: ["notifications"] });
		},
		onError: (error) => {
			toast.error(getAPIErrorMessage(error) ?? t("notifications.send.failed"));
		}, });

	const toggle = (id: number) => {
		setSelected((current) =>
			current.includes(id)
				? current.filter((item) => item !== id)
				: [...current, id],
		);
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4 max-w-[42rem]">
				<Field>
					<FieldLabel>{t("notifications.send.title")}</FieldLabel>
					<Input value={title} onChange={(e) => setTitle(e.target.value)} />
				</Field>
				<Field>
					<FieldLabel>{t("notifications.send.body")}</FieldLabel>
					<Textarea value={body} rows={4} onChange={(e) => setBody(e.target.value)} />
				</Field>
				<Field>
					<FieldLabel>{t("notifications.send.audience")}</FieldLabel>
					<RadioGroup value={audience} onValueChange={(value) => setAudience(value as "all" | "selected")}>
						<div className="flex flex-row gap-6">
							<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="all" /><span>{t("notifications.send.audienceAll")}</span></label>
							<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="selected" /><span>{t("notifications.send.audienceSelected")}</span></label>
						</div>
					</RadioGroup>
				</Field>
				{audience === "selected" && (
					<div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto">
						{(recipients.data?.items ?? []).map((admin) => (
							<label key={admin.id} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={selected.includes(admin.id)} onCheckedChange={() => toggle(admin.id)} /><span>{admin.username}
								<span className="text-[0.75rem] text-gray-500 ms-2">
									{admin.role}
								</span></span></label>
						))}
					</div>
				)}
				<div className="flex flex-row items-center gap-2">
					<Button disabled={
							!title.trim() ||
							!body.trim() ||
							(audience === "selected" && selected.length === 0)
						} onClick={() =>
							mutation.mutate({
								title,
								body,
								audience,
								admin_ids: selected,
							})
						} loading={mutation.isPending} className="bg-blue-600 text-white shadow-xs hover:bg-blue-700">
						{t("notifications.send.submit")}
					</Button>
				</div>
			</div>
			<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
			<div className="flex flex-col gap-3">
				<p className="font-semibold">{t("notifications.send.history")}</p>
				{(sent.data?.items ?? []).length === 0 && (
					<p className="text-gray-500 text-[0.875rem]">
						{t("notifications.send.historyEmpty")}
					</p>
				)}
				{(sent.data?.items ?? []).map((item) => (
					<div key={item.id} className="p-3 rounded-md border">
						<div className="flex flex-row items-center gap-2 justify-between">
							<p className="font-medium">{item.title}</p>
							<p className="text-[0.75rem] text-gray-500">
								{formatTime(item.created_at)}
							</p>
						</div>
						<p className="text-[0.875rem] whitespace-pre-wrap">
							{item.body}
						</p>
						<p className="text-[0.75rem] text-gray-500 mt-1">
							{t("notifications.send.readCount", {
								read: item.read,
								total: item.recipients,
							})}
						</p>
					</div>
				))}
			</div>
		</div>
	);
};

const RuleEditor = ({ rule }: { rule: NotificationRule }) => {
	const { t } = useTranslation();
	
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(rule.enabled);
	const [threshold, setThreshold] = useState(String(rule.threshold));
	const [title, setTitle] = useState(rule.title);
	const [body, setBody] = useState(rule.body);
	const save = useMutation({ mutationFn: (payload: {
			enabled: boolean;
			threshold: number;
			title: string;
			body: string;
		}) => updateNotificationRule(rule.key, payload), onSuccess: () => {
				toast.success(t("notifications.rules.saved"));
				queryClient.invalidateQueries({ queryKey: ["notifications", "rules"] });
			},
			onError: (error) => {
				toast.error(getAPIErrorMessage(error) ?? t("notifications.rules.failed"));
			}, });

	const submit = () =>
		save.mutate({
			enabled: rule.mandatory ? true : enabled,
			threshold: rule.unit === "none" ? 0 : Number(threshold),
			title,
			body,
		});

	const resetToDefaults = () => {
		setEnabled(rule.mandatory ? true : rule.default_enabled);
		setThreshold(String(rule.default_threshold));
		setTitle(rule.default_title);
		setBody(rule.default_body);
		save.mutate({
			enabled: rule.mandatory ? true : rule.default_enabled,
			threshold: rule.unit === "none" ? 0 : rule.default_threshold,
			title: rule.default_title,
			body: rule.default_body,
		});
	};

	return (
		<div className="p-4 rounded-md border">
			<div className="flex flex-row items-center gap-2 justify-between mb-3">
				<p className="font-semibold">
					{t(`notifications.rules.name.${rule.key}`)}
				</p>
				<div className="flex flex-row items-center gap-2">
					<p className="text-[0.875rem]">
						{rule.mandatory ? t("notifications.rules.mandatory") : t("notifications.rules.enabled")}
					</p>
					<Switch checked={rule.mandatory ? true : enabled} disabled={rule.mandatory} onCheckedChange={(checked: boolean) => setEnabled(checked)} />
				</div>
			</div>
			<div className="flex flex-col gap-3">
				{rule.unit !== "none" && (
					<Field className="max-w-[200px]">
						<FieldLabel>
							{t("notifications.rules.threshold")} (
							{rule.unit === "percent"
								? t("notifications.rules.unitPercent")
								: t("notifications.rules.unitDays")}
							)
						</FieldLabel>
						<Input type="number" min={1} max={rule.unit === "percent" ? 100 : 365} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
					</Field>
				)}
				<Field>
					<FieldLabel>{t("notifications.send.title")}</FieldLabel>
					<Input value={title} onChange={(e) => setTitle(e.target.value)} />
				</Field>
				<Field>
					<FieldLabel>{t("notifications.send.body")}</FieldLabel>
					<Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
				</Field>
				<p className="text-[0.75rem] text-gray-500">
					{t("notifications.rules.placeholders", {
						list: rule.placeholders.map((item) => `{${item}}`).join(", "),
					})}
				</p>
				<p className="text-[0.75rem] text-gray-500">
					{t(
						rule.recipients === "admin"
							? "notifications.rules.recipientsAdmin"
							: "notifications.rules.recipientsOperators",
					)}
				</p>
				<div className="flex flex-row items-center gap-2">
					<Button onClick={submit} size="sm" loading={save.isPending} className="bg-blue-600 text-white shadow-xs hover:bg-blue-700">
						{t("notifications.rules.save")}
					</Button>
					<Button onClick={resetToDefaults} variant="outline" size="sm">
						{t("notifications.rules.reset")}
					</Button>
				</div>
			</div>
		</div>
	);
};

const RulesPanel = () => {
	const { t } = useTranslation();
	const rules = useQuery({ queryKey: ["notifications", "rules"], queryFn: () =>
		getNotificationRules() });
	return (
		<div className="flex flex-col gap-4">
			<p className="text-gray-500 text-[0.875rem]">
				{t("notifications.rules.description")}
			</p>
			{(rules.data?.items ?? []).map((rule) => (
				<RuleEditor key={rule.key} rule={rule} />
			))}
		</div>
	);
};

export default function NotificationsPage() {
	const { t } = useTranslation();
	const { userData } = useGetUser();
	const canSend =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const [tab, setTab] = useState<"inbox" | "send" | "rules">("inbox");
	const sections = [
		{ id: "inbox" as const, label: t("notifications.tabs.inbox"), visible: true },
		{ id: "send" as const, label: t("notifications.tabs.send"), visible: canSend },
		{ id: "rules" as const, label: t("notifications.tabs.rules"), visible: isFullAccess },
	].filter((section) => section.visible);
	const current = sections.some((section) => section.id === tab) ? tab : "inbox";

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title={t("notifications.menu")}
				description={t("notifications.description")}
			/>
			<TabSystem
				tabs={sections.map((section) => ({
					value: section.id,
					label: section.label,
					isActive: current === section.id,
					onClick: () => setTab(section.id),
				}))}
				className="overflow-x-auto overflow-y-hidden max-w-full master-settings-tabs"
			/>
			{current === "inbox" && <InboxPanel />}
			{current === "send" && <SendPanel />}
			{current === "rules" && <RulesPanel />}
		</div>
	);
}
