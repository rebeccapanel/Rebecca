import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Field, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "components/ui/radio-group";
import { Checkbox } from "components/ui/checkbox";
import { Switch } from "components/ui/switch";
import { toast } from "components/ui/sonner";
import { Check, CheckCheck, MailOpen, RotateCcw, Send } from "lucide-react";


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
			<div className="flex flex-row flex-wrap items-center justify-between gap-2 rounded-[14px] border border-panel-border/80! bg-panel-surface px-4 py-2.5">
				<p className="text-[13px] font-medium text-panel-text-secondary">
					{t("notifications.inbox.summary", {
						unread: inbox.data?.unread ?? 0,
						total: inbox.data?.total ?? 0,
					})}
				</p>
				<Button
					disabled={!inbox.data?.unread}
					onClick={() => markAll.mutate()}
					variant="outline"
					size="sm"
					loading={markAll.isPending}
					className="h-8 rounded-[10px] border-panel-border! text-xs font-semibold"
				>
					<CheckCheck className="size-3.5 text-panel-accent" />
					<span>{t("notifications.inbox.markAllRead")}</span>
				</Button>
			</div>
			{items.length === 0 && (
				<div className="flex flex-col items-center justify-center gap-2 rounded-[16px] border border-panel-border! bg-panel-surface px-6 py-10 text-center">
					<span className="flex size-10 items-center justify-center rounded-[12px] bg-panel-elevated text-panel-text-muted">
						<MailOpen className="size-5" strokeWidth={1.75} />
					</span>
					<p className="text-[13px] font-medium text-panel-text-muted">
						{t("notifications.inbox.empty")}
					</p>
				</div>
			)}
			<div className="flex flex-col gap-2.5">
				{items.map((item) => {
					const isUnread = item.read_at === null;
					return (
						<div
							key={item.id}
							className={cn(
								"rounded-[16px] border p-4 transition-colors",
								isUnread
									? "border-panel-border-strong! bg-panel-elevated/60"
									: "border-panel-border! bg-panel-surface",
							)}
						>
							<div className="mb-1.5 flex flex-row items-start justify-between gap-3">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									{isUnread ? (
										<span className="size-2 shrink-0 rounded-full bg-panel-accent" />
									) : null}
									<p className="text-[14px] font-bold text-panel-text">
										{item.title}
									</p>
									{isUnread && (
										<Badge className="rounded-full bg-panel-accent/14 text-panel-accent hover:bg-panel-accent/14">
											{t("notifications.inbox.unread")}
										</Badge>
									)}
								</div>
								<p
									dir="ltr"
									className="shrink-0 whitespace-nowrap text-[11px] font-medium text-panel-text-muted tabular-nums [unicode-bidi:isolate]"
								>
									{formatTime(item.created_at)}
								</p>
							</div>
							<p className="whitespace-pre-wrap text-[13px] leading-relaxed text-panel-text-secondary">
								{item.body}
							</p>
							<div className="mt-3 flex flex-row items-center justify-between gap-2">
								<p className="text-[11.5px] font-medium text-panel-text-muted">
									{t("notifications.inbox.from", {
										sender: item.sender_username,
									})}
								</p>
								{isUnread && (
									<Button
										onClick={() => markOne.mutate(item.id)}
										variant="ghost"
										size="xs"
										className="h-7 rounded-[9px] px-2.5 text-[11.5px] font-semibold"
									>
										<Check className="size-3.5 text-panel-accent" />
										<span>{t("notifications.inbox.markRead")}</span>
									</Button>
								)}
							</div>
						</div>
					);
				})}
			</div>
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
							<label
								key={admin.id}
								className="flex cursor-pointer items-center gap-2 text-sm text-panel-text"
							>
								<Checkbox
									checked={selected.includes(admin.id)}
									onCheckedChange={() => toggle(admin.id)}
								/>
								<span>
									{admin.username}
									<span className="ms-2 text-[0.75rem] text-panel-text-muted">
										{admin.role}
									</span>
								</span>
							</label>
						))}
					</div>
				)}
				<div className="flex flex-row items-center gap-2">
					<Button
						disabled={
							!title.trim() ||
							!body.trim() ||
							(audience === "selected" && selected.length === 0)
						}
						onClick={() =>
							mutation.mutate({
								title,
								body,
								audience,
								admin_ids: selected,
							})
						}
						loading={mutation.isPending}
						className="h-9 rounded-[12px] px-4 text-xs font-semibold"
					>
						<Send className="size-3.5" />
						<span>{t("notifications.send.submit")}</span>
					</Button>
				</div>
			</div>
			<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
			<div className="flex flex-col gap-3">
				<p className="text-[14px] font-bold text-panel-text">
					{t("notifications.send.history")}
				</p>
				{(sent.data?.items ?? []).length === 0 && (
					<p className="text-[13px] text-panel-text-muted">
						{t("notifications.send.historyEmpty")}
					</p>
				)}
				{(sent.data?.items ?? []).map((item) => (
					<div
						key={item.id}
						className="rounded-[16px] border border-panel-border! bg-panel-surface p-3.5"
					>
						<div className="flex flex-row items-center justify-between gap-2">
							<p className="text-[13px] font-bold text-panel-text">
								{item.title}
							</p>
							<p
								dir="ltr"
								className="shrink-0 text-[11px] font-medium text-panel-text-muted tabular-nums [unicode-bidi:isolate]"
							>
								{formatTime(item.created_at)}
							</p>
						</div>
						<p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-panel-text-secondary">
							{item.body}
						</p>
						<p className="mt-2 text-[11.5px] font-medium text-panel-text-muted">
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
		<div className="rounded-[16px] border border-panel-border! bg-panel-surface p-4">
			<div className="mb-3 flex flex-row items-center justify-between gap-2">
				<p className="text-[14px] font-bold text-panel-text">
					{t(`notifications.rules.name.${rule.key}`)}
				</p>
				<div className="flex flex-row items-center gap-2">
					<p className="text-[13px] font-medium text-panel-text-secondary">
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
				<p className="text-[11.5px] text-panel-text-muted">
					{t("notifications.rules.placeholders", {
						list: rule.placeholders.map((item) => `{${item}}`).join(", "),
					})}
				</p>
				<p className="text-[11.5px] text-panel-text-muted">
					{t(
						rule.recipients === "admin"
							? "notifications.rules.recipientsAdmin"
							: "notifications.rules.recipientsOperators",
					)}
				</p>
				<div className="flex flex-row items-center gap-2 pt-1">
					<Button
						onClick={submit}
						size="sm"
						loading={save.isPending}
						className="h-8 rounded-[10px] text-xs font-semibold"
					>
						{t("notifications.rules.save")}
					</Button>
					<Button
						onClick={resetToDefaults}
						variant="outline"
						size="sm"
						className="h-8 rounded-[10px] border-panel-border! text-xs font-semibold"
					>
						<RotateCcw className="size-3.5" />
						<span>{t("notifications.rules.reset")}</span>
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
			<p className="text-[13px] text-panel-text-secondary">
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
