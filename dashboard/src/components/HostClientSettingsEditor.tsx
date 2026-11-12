import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NativeSelect } from "components/ui/native-select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "components/ui/accordion";
import { Textarea } from "components/ui/textarea";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";


import { cn } from "lib/cn";
import { useTranslation } from "react-i18next";
import { hostClientSettingsError, parseHostClientSettings } from "utils/hostClientSettings";

const TLS_FIELDS = [
	["echConfigList", "ECH Config List", "cloudflare-ech.com+udp://1.1.1.1"],
	["cipherSuites", "TLS Cipher Suites", "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
	["curvePreferences", "TLS Curve Preferences", "X25519, CurveP256"],
] as const;

const PERFORMANCE_FIELDS: Record<string, readonly string[]> = {
	sockopt: ["tcpFastOpen", "tcpMptcp", "tcpKeepAliveIdle", "tcpKeepAliveInterval", "tcpUserTimeout", "tcpCongestion", "tcpMaxSeg", "tcpWindowClamp", "domainStrategy"],
	wsSettings: ["heartbeatPeriod"],
	grpcSettings: ["multiMode", "idle_timeout", "health_check_timeout", "permit_without_stream", "initial_windows_size", "user_agent"],
	kcpSettings: ["uplinkCapacity", "downlinkCapacity"],
	xhttpSettings: ["scMaxEachPostBytes", "scMinPostsIntervalMs"],
	mux: ["concurrency", "xudpConcurrency", "xudpProxyUDP443"],
};
const BOOL_FIELDS = new Set(["tcpFastOpen", "tcpMptcp", "permit_without_stream", "multiMode"]);
const TEXT_FIELDS = new Set(["tcpCongestion", "domainStrategy", "user_agent", "scMaxEachPostBytes", "scMinPostsIntervalMs", "xudpProxyUDP443"]);

export const HostClientSettingsEditor = ({ value, onChange, usesTLS, protocol, network }: {
	value: string;
	onChange: (value: string) => void;
	usesTLS: boolean;
	protocol?: string;
	network?: string;
}) => {
	const { t } = useTranslation();
	const error = hostClientSettingsError(value);
	const settings = error ? {} : parseHostClientSettings(value);
	const object = (group: string) => {
		const result = settings[group];
		return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
	};
	const update = (group: string, key: string, next: unknown) => {
		const changed = { ...object(group) };
		if (next === undefined) delete changed[key];
		else changed[key] = next;
		const result = { ...settings };
		if (Object.keys(changed).length) result[group] = changed;
		else delete result[group];
		onChange(JSON.stringify(result, null, 2));
	};
	const transportGroup = ({ ws: "wsSettings", httpupgrade: "httpupgradeSettings", grpc: "grpcSettings", gun: "grpcSettings", kcp: "kcpSettings", mkcp: "kcpSettings", xhttp: "xhttpSettings", splithttp: "xhttpSettings" } as Record<string, string>)[network ?? ""];
	return (
		<div className="flex flex-col gap-3">
			<p className="text-[0.875rem] text-gray-500">{t("hostsDialog.clientSettingsHint")}</p>
			{usesTLS && (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					{TLS_FIELDS.map(([key, label, placeholder]) => (
						<Field key={key} className={cn(key === "echConfigList" ? "[grid-column:1_/_-1]" : "")}>
							<div className="flex flex-row items-center gap-2 justify-between">
								<FieldLabel>{label}</FieldLabel>
								<Button disabled={Boolean(error)} onClick={() => update("tlsSettings", key, undefined)} variant="ghost" size="xs">{t("hostsDialog.clientInherit")}</Button>
							</div>
							<Input dir="ltr" value={String(object("tlsSettings")[key] ?? "")} onChange={(event) => update("tlsSettings", key, key === "curvePreferences" ? event.target.value ? event.target.value.split(",").map((item) => item.trim()) : [] : event.target.value.trim())} onBlur={() => {
									if (key === "curvePreferences" && Array.isArray(object("tlsSettings")[key])) {
										update("tlsSettings", key, (object("tlsSettings")[key] as string[]).filter(Boolean));
									}
								}} />
							{key === "echConfigList" && <FieldDescription>{t("hostsDialog.clientECHHint")}</FieldDescription>}
						</Field>
					))}
					{["minVersion", "maxVersion", "enableSessionResumption", "disableSystemRoot"].map((key) => {
						const bool = key === "enableSessionResumption" || key === "disableSystemRoot";
						return <Field key={key}>
							<FieldLabel>{key}</FieldLabel>
							<NativeSelect value={String(object("tlsSettings")[key] ?? "")} onChange={(event) => update("tlsSettings", key, event.target.value === "" ? undefined : bool ? event.target.value === "true" : event.target.value)}>
								<option value="">{t("hostsDialog.clientInherit")}</option>
								{(bool ? ["true", "false"] : ["1.0", "1.1", "1.2", "1.3"]).map((option) => <option key={option} value={option}>{option}</option>)}
							</NativeSelect>
						</Field>;
					})}
				</div>
			)}
			{protocol === "vmess" && <Field>
				<FieldLabel>VMess Client Encryption</FieldLabel>
				<NativeSelect value={String(settings.vmessSecurity ?? "")} onChange={(event) => {
					const next = { ...settings };
					if (event.target.value) next.vmessSecurity = event.target.value;
					else delete next.vmessSecurity;
					onChange(JSON.stringify(next, null, 2));
				}}>
					{["", "auto", "aes-128-gcm", "chacha20-poly1305", "none", "zero"].map((option) => <option key={option} value={option}>{option || t("hostsDialog.clientInherit")}</option>)}
				</NativeSelect>
			</Field>}
			<Accordion type="single" collapsible>
				<AccordionItem value="tuning" className="border-0">
					<AccordionTrigger><div className="flex-1 text-start">{t("hostsDialog.clientTuning")}</div></AccordionTrigger>
					<AccordionContent forceMount className="px-0">
						<div className="flex flex-col gap-4">
							<p className="text-[0.875rem] text-orange-400">{t("hostsDialog.clientJSONHint")}</p>
							{["sockopt", transportGroup, "mux"].filter(Boolean).map((group) => (
								<div key={group} className="flex flex-col gap-2">
									<p className="font-semibold">{group}</p>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
										{(PERFORMANCE_FIELDS[group] ?? []).map((key) => <Field key={key}>
											<FieldLabel className="text-[0.875rem]">{key}</FieldLabel>
											{BOOL_FIELDS.has(key) ? <NativeSelect value={String(object(group)[key] ?? "")} onChange={(event) => update(group, key, event.target.value === "" ? undefined : event.target.value === "true")}>
												<option value="">{t("hostsDialog.clientInherit")}</option><option value="true">true</option><option value="false">false</option>
											</NativeSelect> : <Input dir="ltr" type={TEXT_FIELDS.has(key) ? "text" : "number"} min={-1} step={1} value={String(object(group)[key] ?? "")} onChange={(event) => update(group, key, event.target.value === "" ? undefined : TEXT_FIELDS.has(key) ? event.target.value : Number(event.target.value))} />}
										</Field>)}
									</div>
								</div>
							))}
							<Field data-invalid={Boolean(error)}>
								<FieldLabel>{t("hostsDialog.clientSettingsJSON")}</FieldLabel>
								<Textarea dir="ltr" rows={8} value={value} onChange={(event) => onChange(event.target.value)} className="font-mono" />
								<FieldError>{error}</FieldError>
								<FieldDescription>{t("hostsDialog.clientExtraHint")}</FieldDescription>
							</Field>
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
};
