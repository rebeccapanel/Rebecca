import {
	Button,
	Divider,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Select,
	Switch,
	Text,
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
	isOpen: boolean;
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

const parseCsvList = (value: string) =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const joinCsvList = (value?: string[] | null) =>
	Array.isArray(value) ? value.join(",") : "";

export const DnsModal: FC<DnsModalProps> = ({
	isOpen,
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
	}, [isOpen, currentDnsData, dnsIndex, modalForm]);

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

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="md">
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader pt={6}>
							<Text fontWeight="semibold" fontSize="lg">
								{isEdit ? t("pages.xray.dns.edit") : t("pages.xray.dns.add")}
							</Text>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				<ModalBody>
					<form onSubmit={handleSubmit}>
						<VStack spacing={4}>
							<FormControl>
								<FormLabel>{t("pages.xray.dns.address")}</FormLabel>
								<Input
									{...modalForm.register("address")}
									size="sm"
									placeholder="8.8.8.8"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.dns.port")}</FormLabel>
								<Input
									{...modalForm.register("port")}
									type="number"
									size="sm"
									placeholder="53"
									min={1}
									max={65535}
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.dns.strategy")}</FormLabel>
								<Select
									{...modalForm.register("queryStrategy")}
									size="sm"
									maxW="240px"
								>
									{["UseSystem", "UseIP", "UseIPv4", "UseIPv6"].map(
										(strategy) => (
											<option key={strategy} value={strategy}>
												{strategy}
											</option>
										),
									)}
								</Select>
							</FormControl>
							<Divider />
							<FormControl>
								<FormLabel>{t("pages.xray.dns.domains")}</FormLabel>
								<Input
									{...modalForm.register("domains")}
									size="sm"
									placeholder="example.com,*.example.com"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.dns.expectIPs")}</FormLabel>
								<Input
									{...modalForm.register("expectIPs")}
									size="sm"
									placeholder="1.1.1.1,2.2.2.2"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.dns.unexpectIPs")}</FormLabel>
								<Input
									{...modalForm.register("unexpectedIPs")}
									size="sm"
									placeholder="3.3.3.3,4.4.4.4"
								/>
							</FormControl>
							<Divider />
							<FormControl display="flex" alignItems="center">
								<FormLabel mb={0}>
									{t("pages.xray.dns.skipFallback")}
								</FormLabel>
								<Controller
									name="skipFallback"
									control={modalForm.control}
									render={({ field }) => (
										<Switch
											isChecked={field.value}
											onChange={(event) =>
												field.onChange(event.target.checked)
											}
										/>
									)}
								/>
							</FormControl>
							<FormControl display="flex" alignItems="center">
								<FormLabel mb={0}>
									{t("pages.xray.dns.disableCache")}
								</FormLabel>
								<Controller
									name="disableCache"
									control={modalForm.control}
									render={({ field }) => (
										<Switch
											isChecked={field.value}
											onChange={(event) =>
												field.onChange(event.target.checked)
											}
										/>
									)}
								/>
							</FormControl>
							<FormControl display="flex" alignItems="center">
								<FormLabel mb={0}>
									{t("pages.xray.dns.finalQuery")}
								</FormLabel>
								<Controller
									name="finalQuery"
									control={modalForm.control}
									render={({ field }) => (
										<Switch
											isChecked={field.value}
											onChange={(event) =>
												field.onChange(event.target.checked)
											}
										/>
									)}
								/>
							</FormControl>
							<Button type="submit" colorScheme="primary" size="sm" w="full">
								{isEdit ? t("pages.xray.dns.edit") : t("pages.xray.dns.add")}
							</Button>
						</VStack>
					</form>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
