import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { useBreakpointValue } from "hooks/useBreakpointValue";
import { cn } from "lib/cn";
import { getSwipeTargetIndex } from "utils/carousel";
import { copyTextToClipboard } from "utils/clipboard";
import { getConfigLabelFromLink } from "utils/configLabel";
import { useDashboard } from "../contexts/DashboardContext";

type QRCopyPanelProps = {
	value: string;
	size: number;
	/** Accessible name for the QR, which copies on click. */
	label: string;
	/** Set on the carousel only: a horizontal swipe moves to another config. */
	onSwipe?: (delta: number) => void;
};

/**
 * A QR code that copies its value on click, with the value and an explicit copy button
 * under it. The copy state lives here, so callers remount it (via `key`) to reset it.
 */
const QRCopyPanel = ({ value, size, label, onSwipe }: QRCopyPanelProps) => {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const qrRef = useRef<HTMLButtonElement>(null);
	const touchStartX = useRef<number | null>(null);
	// A swipe can end on the QR; the click that follows it must not copy.
	const swiped = useRef(false);

	useEffect(() => {
		if (!copied) return undefined;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const copyText = () =>
		copyTextToClipboard(value)
			.then(() => setCopied(true))
			.catch(() => undefined);

	// Clicking the QR copies the picture itself; without image clipboard support it falls back to the link text.
	const copyQrImage = async () => {
		const canvas = qrRef.current?.querySelector("canvas");
		if (!canvas || !navigator.clipboard?.write) return copyText();
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!blob) return copyText();
		await navigator.clipboard
			.write([new ClipboardItem({ "image/png": blob })])
			.then(() => setCopied(true))
			.catch(() => undefined);
	};

	return (
		<div className="flex w-full flex-col items-center gap-4">
			<button
				ref={qrRef}
				type="button"
				aria-label={label}
				onClick={() => {
					if (swiped.current) {
						swiped.current = false;
						return;
					}
					void copyQrImage();
				}}
				onTouchStart={(event) => {
					touchStartX.current = event.touches[0]?.clientX ?? null;
					swiped.current = false;
				}}
				onTouchEnd={(event) => {
					const startX = touchStartX.current;
					touchStartX.current = null;
					if (startX === null || !onSwipe) return;
					const delta = (event.changedTouches[0]?.clientX ?? startX) - startX;
					if (Math.abs(delta) < 40) return;
					swiped.current = true;
					onSwipe(delta);
				}}
				className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
			>
				<QRCodeCanvas value={value} size={size} level="M" includeMargin={false} />
			</button>
			<div className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
				<p dir="ltr" title={value} className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
					{value}
				</p>
				<button
					type="button"
					onClick={() => void copyText()}
					className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1.5")}
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
					{copied ? t("copied") : t("copy")}
				</button>
			</div>
		</div>
	);
};

/** Subscription and per-config QR codes for one user, shown in a shadcn dialog. */
export const QRCodeDialog: FC = () => {
	const { t } = useTranslation();
	const QRcodeLinks = useDashboard((state) => state.QRcodeLinks);
	const qrCodeUsername = useDashboard((state) => state.qrCodeUsername);
	const setQRCode = useDashboard((state) => state.setQRCode);
	const setSubLink = useDashboard((state) => state.setSubLink);
	const subscribeUrl = useDashboard((state) => state.subscribeUrl);
	const [configIndex, setConfigIndex] = useState(0);
	const qrSize = useBreakpointValue({ base: 200, sm: 220 }) ?? 200;

	const configItems = useMemo(
		() =>
			(QRcodeLinks ?? []).map((link, itemIndex) => ({
				link,
				label:
					getConfigLabelFromLink(link) ||
					t("userDialog.links.configFallback", { index: itemIndex + 1 }),
			})),
		[QRcodeLinks, t],
	);

	const activeIndex = Math.min(configIndex, Math.max(configItems.length - 1, 0));
	const activeConfig = configItems[activeIndex];
	const hasSubscription = Boolean(subscribeUrl);
	const subscribeQrLink = String(subscribeUrl).startsWith("/")
		? window.location.origin + subscribeUrl
		: String(subscribeUrl);

	const onClose = () => {
		setQRCode(null);
		setSubLink(null);
	};

	const stepConfig = (step: number) =>
		setConfigIndex((current) => (current + step + configItems.length) % configItems.length);

	const subscriptionView = (
		<QRCopyPanel value={subscribeQrLink} size={qrSize} label={t("a11y.copySubscriptionLink")} />
	);

	const configsView = activeConfig && (
		<div className="flex w-full flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<button
					type="button"
					aria-label={t("a11y.previous")}
					disabled={configItems.length < 2}
					onClick={() => stepConfig(-1)}
					className={buttonVariants({ variant: "outline", size: "icon" })}
				>
					<ChevronLeft className="rtl:rotate-180" />
				</button>
				<div className="min-w-0 text-center">
					<p className="truncate text-sm font-semibold">{activeConfig.label}</p>
					<p className="text-xs tabular-nums text-muted-foreground">
						{activeIndex + 1} / {configItems.length}
					</p>
				</div>
				<button
					type="button"
					aria-label={t("a11y.next")}
					disabled={configItems.length < 2}
					onClick={() => stepConfig(1)}
					className={buttonVariants({ variant: "outline", size: "icon" })}
				>
					<ChevronRight className="rtl:rotate-180" />
				</button>
			</div>
			<QRCopyPanel
				key={activeIndex}
				value={activeConfig.link}
				size={qrSize}
				label={t("a11y.copyConfig")}
				onSwipe={
					configItems.length > 1
						? (delta) => setConfigIndex((current) => getSwipeTargetIndex(current, configItems.length, delta))
						: undefined
				}
			/>
		</div>
	);

	const renderBody = () => {
		if (hasSubscription && configItems.length > 0) {
			return (
				<Tabs defaultValue="subscription" className="w-full">
					<TabsList className="w-full">
						<TabsTrigger value="subscription">{t("userDialog.links.subscription")}</TabsTrigger>
						<TabsTrigger value="configs">{t("userDialog.links.configs")}</TabsTrigger>
					</TabsList>
					<TabsContent value="subscription" className="pt-5">
						{subscriptionView}
					</TabsContent>
					<TabsContent value="configs" className="pt-5">
						{configsView}
					</TabsContent>
				</Tabs>
			);
		}
		if (hasSubscription) return subscriptionView;
		if (configsView) return configsView;
		return (
			<p className="py-6 text-center text-sm text-muted-foreground">{t("userDialog.links.noConfigs")}</p>
		);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[min(560px,calc(100dvh-10rem))] gap-0 overflow-hidden p-0 sm:max-w-md">
				<DialogHeader className="border-b border-border px-6 py-4 pe-12 text-start sm:text-start">
					<DialogTitle>{t("usersTable.qrCode")}</DialogTitle>
					{qrCodeUsername && (
						<DialogDescription dir="ltr" className="truncate text-start">
							{qrCodeUsername}
						</DialogDescription>
					)}
				</DialogHeader>
				<div className="overflow-y-auto px-6 py-5">{renderBody()}</div>
			</DialogContent>
		</Dialog>
	);
};
