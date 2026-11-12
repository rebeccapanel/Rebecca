import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Dialog } from "components/ui/dialog";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Zap } from "lucide-react";

import { cn } from "lib/cn";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import type { RoutingRule } from "../RuleModal";
import {
	XrayDialogSection,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./XrayDialog";

type OutboundTraffic = {
	tag: string;
	up: number;
	down: number;
};

type RouteTestResult = {
	success: boolean;
	delay?: number;
	statusCode?: number;
	matched?: boolean;
	outboundTag?: string;
	groupTags?: string[];
	outboundTraffic?: OutboundTraffic[];
	error?: string;
};

type RouteTestModalProps = {
	open: boolean;
	onClose: () => void;
	rule: RoutingRule | null;
	target: string;
	targetName: string;
	isMasterTarget: boolean;
	config: unknown;
};

const firstRuleInbound = (rule: RoutingRule | null) =>
	String(rule?.inboundTag?.[0] || "route-test").trim() || "route-test";

const firstRuleURL = (rule: RoutingRule | null) => {
	const domain = String(rule?.domain?.find((item) => !item.includes(":")) || "").trim();
	if (domain) return `https://${domain}/`;
	const ip = String(rule?.ip?.[0] || "").trim();
	return ip ? `http://${ip}/` : "https://www.google.com/generate_204";
};

const formatBytes = (value: number) => {
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
	return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

export const RouteTestModal: FC<RouteTestModalProps> = ({
	open: isOpen,
	onClose,
	rule,
	target,
	targetName,
	isMasterTarget,
	config,
}) => {
	const { t } = useTranslation();
	const [testURL, setTestURL] = useState("");
	const [inboundTag, setInboundTag] = useState("");
	const [isTesting, setIsTesting] = useState(false);
	const [result, setResult] = useState<RouteTestResult | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setTestURL(firstRuleURL(rule));
		setInboundTag(firstRuleInbound(rule));
		setResult(null);
	}, [isOpen, rule]);

	const runTest = async () => {
		setIsTesting(true);
		setResult(null);
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: RouteTestResult;
				msg?: string;
			}>("/panel/xray/routeTest", {
				method: "POST",
				body: {
					target_id: target,
					config: JSON.stringify(config || {}),
					test_url: testURL.trim(),
					inbound_tag: inboundTag.trim(),
				},
			});
			if (!response?.success || !response.obj) {
				throw new Error(response?.msg || t("pages.xray.routeTest.failed"));
			}
			setResult(response.obj);
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.routeTest.failed");
			setResult({ error: typeof detail === "string" ? detail : String(detail), success: false });
		} finally {
			setIsTesting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<XrayModalHeader>{t("pages.xray.routeTest.title")}</XrayModalHeader>
				
				<XrayModalBody>
					<div className="flex flex-col items-stretch gap-3">
						<XrayDialogSection>
							<p className="text-[0.875rem] text-panel-text-muted">
								{isMasterTarget
									? t("pages.xray.routeTester.nodeTargetRequired")
									: t("pages.xray.routeTest.description", { target: targetName })}
							</p>
						</XrayDialogSection>
						<Field>
							<FieldLabel>{t("pages.xray.routeTest.url")}</FieldLabel>
							<Input value={testURL} onChange={(event) => setTestURL(event.target.value)} />
							<FieldDescription>{t("pages.xray.routeTest.urlHint")}</FieldDescription>
						</Field>
						<Field>
							<FieldLabel>{t("pages.xray.routeTest.inboundTag")}</FieldLabel>
							<Input value={inboundTag} onChange={(event) => setInboundTag(event.target.value)} />
							<FieldDescription>{t("pages.xray.routeTest.inboundHint")}</FieldDescription>
						</Field>
						{result && (
							<XrayDialogSection>
								<div className="flex flex-col items-stretch gap-2">
									<p className={cn("font-semibold text-[0.875rem]", result.success ? "text-green-300" : "text-red-300")}>
										{result.success
											? t("pages.xray.routeTest.success")
											: result.error || t("pages.xray.routeTest.failed")}
									</p>
									{result.success && (
										<div className="flex flex-row items-center gap-2 flex-wrap">
											<Badge>{result.delay ?? 0} ms</Badge>
											{result.statusCode ? <Badge>HTTP {result.statusCode}</Badge> : null}
											{result.outboundTag ? <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">{result.outboundTag}</Badge> : null}
											{result.groupTags?.map((tag) => <Badge key={tag} className="bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-500/20 dark:text-orange-200">{tag}</Badge>)}
										</div>
									)}
									{result.outboundTraffic?.length ? (
										<div className="flex flex-wrap gap-2">
											{result.outboundTraffic.map((traffic) => (
												<div key={traffic.tag}>
													<Badge className="bg-green-600 text-white">
														{traffic.tag}: {formatBytes(traffic.up + traffic.down)}
													</Badge>
												</div>
											))}
										</div>
									) : null}
								</div>
							</XrayDialogSection>
						)}
					</div>
				</XrayModalBody>
				<XrayModalFooter>
					<Button onClick={onClose} variant="ghost">{t("close")}</Button>
					<Button onClick={runTest} disabled={isMasterTarget || !testURL.trim()} loading={isTesting}><Zap />
						{t("pages.xray.routeTester.test")}
					</Button>
				</XrayModalFooter>
			</XrayModalContent>
		</Dialog>
	);
};
