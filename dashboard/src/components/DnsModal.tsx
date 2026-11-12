import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { FormSection } from "components/ui/form-section";
import { Input as UiInput } from "components/ui/input";
import { NumberField } from "components/ui/number-field";
import { SegmentedControl } from "components/ui/segmented-control";
import { ToggleRow } from "components/ui/toggle-row";
import { Globe } from "lucide-react";
import { type FC, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { MultiValueAutocomplete } from "./common/MultiValueAutocomplete";

type DnsFormValues = {
	address: string;
	port: string;
	queryStrategy: string;
	domains: string;
	expectIPs: string;
	unexpectedIPs: string;
	skipFallback: boolean;
	disableCache: boolean;
	finalQuery: boolean;
};

type DnsConfig = {
	address: string;
	port?: number;
	queryStrategy?: string;
	domains?: string[];
	expectIPs?: string[];
	unexpectedIPs?: string[];
	skipFallback?: boolean;
	disableCache?: boolean;
	finalQuery?: boolean;
};

type DnsServerConfig = DnsConfig | string;

interface DnsModalProps {
	open: boolean;
	onClose: () => void;
	form: UseFormReturn<any>;
	setDnsServers: (data: DnsServerConfig[]) => void;
	dnsIndex?: number | null;
	currentDnsData?: DnsServerConfig | null;
}

const DEFAULT_DNS_SERVER: DnsConfig = {
	address: "localhost",
	port: 53,
	domains: [],
	expectIPs: [],
	unexpectedIPs: [],
	queryStrategy: "UseIP",
	skipFallback: true,
	disableCache: false,
	finalQuery: false,
};

const QUERY_STRATEGIES = ["UseSystem", "UseIP", "UseIPv4", "UseIPv6"].map((value) => ({ value, label: value }));

const dnsShell =
	"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

const parseCsvList = (value: string) =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const joinCsvList = (value?: string[] | null) =>
	Array.isArray(value) ? value.join(",") : "";

export const DnsModal: FC<DnsModalProps> = ({
	open: isOpen,
	onClose,
	form,
	setDnsServers,
	dnsIndex,
	currentDnsData,
}) => {
	const { t } = useTranslation();
	const isEdit = dnsIndex !== null && dnsIndex !== undefined;
	const modalForm = useForm<DnsFormValues>({
		defaultValues: {
			address: "",
			port: String(DEFAULT_DNS_SERVER.port ?? ""),
			queryStrategy: DEFAULT_DNS_SERVER.queryStrategy ?? "UseIP",
			domains: "",
			expectIPs: "",
			unexpectedIPs: "",
			skipFallback: DEFAULT_DNS_SERVER.skipFallback ?? true,
			disableCache: DEFAULT_DNS_SERVER.disableCache ?? false,
			finalQuery: DEFAULT_DNS_SERVER.finalQuery ?? false,
		},
	});

	useEffect(() => {
		if (isOpen && currentDnsData && isEdit) {
			// Edit mode - load existing DNS data
			const dnsData: Partial<DnsConfig> & { address?: string } =
				typeof currentDnsData === "object"
					? currentDnsData
					: { address: currentDnsData };
			const resolved = { ...DEFAULT_DNS_SERVER, ...dnsData };
			modalForm.reset({
				address: resolved.address || "",
				port:
					typeof resolved.port === "number"
						? String(resolved.port)
						: String(DEFAULT_DNS_SERVER.port ?? ""),
				queryStrategy:
					resolved.queryStrategy ?? DEFAULT_DNS_SERVER.queryStrategy ?? "UseIP",
				domains: joinCsvList(resolved.domains),
				expectIPs: joinCsvList(resolved.expectIPs),
				unexpectedIPs: joinCsvList(resolved.unexpectedIPs),
				skipFallback:
					resolved.skipFallback ?? DEFAULT_DNS_SERVER.skipFallback ?? true,
				disableCache:
					resolved.disableCache ?? DEFAULT_DNS_SERVER.disableCache ?? false,
				finalQuery:
					resolved.finalQuery ?? DEFAULT_DNS_SERVER.finalQuery ?? false,
			});
		} else if (isOpen && !isEdit) {
			// Create mode - reset to empty
			modalForm.reset({
				address: "",
				port: String(DEFAULT_DNS_SERVER.port ?? ""),
				queryStrategy: DEFAULT_DNS_SERVER.queryStrategy ?? "UseIP",
				domains: "",
				expectIPs: "",
				unexpectedIPs: "",
				skipFallback: DEFAULT_DNS_SERVER.skipFallback ?? true,
				disableCache: DEFAULT_DNS_SERVER.disableCache ?? false,
				finalQuery: DEFAULT_DNS_SERVER.finalQuery ?? false,
			});
		}
	}, [isOpen, currentDnsData, modalForm, isEdit]);

	const handleSubmit = modalForm.handleSubmit((data) => {
		const portValue = Number.parseInt(data.port, 10);
		const newDns: DnsConfig = {
			address: data.address.trim(),
			port:
				Number.isFinite(portValue) && portValue > 0
					? portValue
					: DEFAULT_DNS_SERVER.port,
			queryStrategy: data.queryStrategy || DEFAULT_DNS_SERVER.queryStrategy,
			domains: data.domains ? parseCsvList(data.domains) : [],
			expectIPs: data.expectIPs ? parseCsvList(data.expectIPs) : [],
			unexpectedIPs: data.unexpectedIPs ? parseCsvList(data.unexpectedIPs) : [],
			skipFallback: data.skipFallback,
			disableCache: data.disableCache,
			finalQuery: data.finalQuery,
		};

		const currentDnsServers: DnsServerConfig[] =
			(form.getValues("config.dns.servers") as DnsServerConfig[] | undefined) ||
			[];
		if (dnsIndex !== null && dnsIndex !== undefined) {
			currentDnsServers[dnsIndex] = newDns;
		} else {
			currentDnsServers.push(newDns);
		}

		form.setValue("config.dns.servers", currentDnsServers, {
			shouldDirty: true,
		});
		setDnsServers(currentDnsServers);
		onClose();
	});

	const title = isEdit ? t("pages.xray.dns.edit") : t("pages.xray.dns.add");

	return (
		<Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
			<DialogContent className={dnsShell}>
				<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Globe className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{title}</DialogTitle>
							<DialogDescription className="truncate">{t("DNS")}</DialogDescription>
						</div>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<div className="flex flex-col gap-5">
							<FormSection>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("pages.xray.dns.address")}>
										<UiInput {...modalForm.register("address")} placeholder="8.8.8.8" autoComplete="off" />
									</FormField>
									<FormField label={t("port")}>
										<Controller
											control={modalForm.control}
											name="port"
											render={({ field }) => (
												<NumberField inputMode="numeric" min={1} max={65535} placeholder="53" value={field.value ?? ""} doneLabel={t("common.done")} onChange={(raw) => field.onChange(raw)} />
											)}
										/>
									</FormField>
								</div>
								<FormField label={t("pages.xray.dns.strategy")} description={t("pages.xray.dns.strategyDesc")}>
									<Controller
										control={modalForm.control}
										name="queryStrategy"
										render={({ field }) => (
											<SegmentedControl<string> label={t("pages.xray.dns.strategy")} value={field.value ?? ""} options={QUERY_STRATEGIES} onChange={(value) => field.onChange(value)} />
										)}
									/>
								</FormField>
							</FormSection>

							<FormSection>
								<FormField label={t("pages.xray.dns.domains")}>
									<Controller
										control={modalForm.control}
										name="domains"
										render={({ field }) => (
											<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="example.com, *.example.com" />
										)}
									/>
								</FormField>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("pages.xray.dns.expectIPs")}>
										<Controller
											control={modalForm.control}
											name="expectIPs"
											render={({ field }) => (
												<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="1.1.1.1, 2.2.2.2" />
											)}
										/>
									</FormField>
									<FormField label={t("pages.xray.dns.unexpectIPs")}>
										<Controller
											control={modalForm.control}
											name="unexpectedIPs"
											render={({ field }) => (
												<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="3.3.3.3, 4.4.4.4" />
											)}
										/>
									</FormField>
								</div>
							</FormSection>

							<FormSection title={t("pages.xray.generalConfigs")}>
								<Controller
									name="skipFallback"
									control={modalForm.control}
									render={({ field }) => (
										<ToggleRow title={t("pages.xray.dns.skipFallback")} checked={field.value} onChange={(next) => field.onChange(next)} />
									)}
								/>
								<Controller
									name="disableCache"
									control={modalForm.control}
									render={({ field }) => (
										<ToggleRow title={t("pages.xray.dns.disableCache")} checked={field.value} onChange={(next) => field.onChange(next)} />
									)}
								/>
								<Controller
									name="finalQuery"
									control={modalForm.control}
									render={({ field }) => (
										<ToggleRow title={t("pages.xray.dns.finalQuery")} checked={field.value} onChange={(next) => field.onChange(next)} />
									)}
								/>
							</FormSection>
						</div>
					</div>
					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={onClose} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button type="submit" size="sm">
							{title}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
