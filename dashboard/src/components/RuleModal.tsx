import {
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	FormControl,
	FormLabel,
	HStack,
	IconButton,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Stack,
	Text,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { type FC, useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { MultiValueAutocomplete } from "./common/MultiValueAutocomplete";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type AttributePair = {
	key: string;
	value: string;
};

type RuleFormValues = {
	type: string;
	domainMatcher: string;
	outboundTag: string;
	balancerTag: string;
	inboundTags: string[];
	networks: string[];
	protocols: string[];
	sourceIps: string;
	sourcePort: string;
	domain: string;
	ip: string;
	user: string;
	port: string;
	attrs: AttributePair[];
};

export type RoutingRule = {
	type?: string;
	domainMatcher?: string;
	outboundTag?: string;
	balancerTag?: string;
	inboundTag?: string[];
	network?: string[];
	protocol?: string[];
	source?: string[];
	sourcePort?: string[];
	domain?: string[];
	ip?: string[];
	user?: string[];
	port?: string;
	attrs?: Record<string, string>;
};

export interface RuleModalProps {
	isOpen: boolean;
	mode: "create" | "edit";
	initialRule?: RoutingRule | null;
	availableInboundTags: string[];
	availableOutboundTags: string[];
	availableBalancerTags: string[];
	onSubmit: (rule: RoutingRule) => void;
	onClose: () => void;
}

const NETWORK_OPTIONS = ["tcp", "udp", "http", "quic", "grpc"];
const PROTOCOL_OPTIONS = ["http", "tls", "bittorrent", "quic"];
const TYPE_OPTIONS = ["field", "chained"];
const DOMAIN_MATCHER_OPTIONS = ["", "hybrid", "linear"];

const defaultFormValues: RuleFormValues = {
	type: "field",
	domainMatcher: "",
	outboundTag: "",
	balancerTag: "",
	inboundTags: [],
	networks: [],
	protocols: [],
	sourceIps: "",
	sourcePort: "",
	domain: "",
	ip: "",
	user: "",
	port: "",
	attrs: [],
};

const toDelimitedString = (value?: string | string[]) => {
	if (!value) {
		return "";
	}
	if (Array.isArray(value)) {
		return value.join(", ");
	}
	return value;
};

const splitStringList = (value: string) =>
	value
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);

const toSingleTag = (value: unknown) => {
	if (Array.isArray(value)) {
		const firstValue = value.find((item) => item != null && String(item).trim());
		return firstValue == null ? "" : String(firstValue).trim();
	}
	return value == null ? "" : String(value).trim();
};

const ruleToFormValues = (rule?: RoutingRule | null): RuleFormValues => {
	if (!rule) {
		return { ...defaultFormValues };
	}

	const attrs: AttributePair[] = rule.attrs
		? Object.entries(rule.attrs).map(([key, value]) => ({
				key,
				value: value == null ? "" : String(value),
			}))
		: [];

	const balancerTag = toSingleTag(rule.balancerTag);
	return {
		type: rule.type ?? "field",
		domainMatcher: rule.domainMatcher ?? "",
		outboundTag: balancerTag ? "" : toSingleTag(rule.outboundTag),
		balancerTag,
		inboundTags: Array.isArray(rule.inboundTag) ? rule.inboundTag : [],
		networks: Array.isArray(rule.network) ? rule.network : [],
		protocols: Array.isArray(rule.protocol) ? rule.protocol : [],
		sourceIps: toDelimitedString(rule.source),
		sourcePort: toDelimitedString(rule.sourcePort),
		domain: toDelimitedString(rule.domain),
		ip: toDelimitedString(rule.ip),
		user: toDelimitedString(rule.user),
		port: toDelimitedString(rule.port),
		attrs,
	};
};

const formValuesToRule = (values: RuleFormValues): RoutingRule => {
	const rule: RoutingRule = {};

	if (values.type) rule.type = values.type;
	if (values.domainMatcher) rule.domainMatcher = values.domainMatcher;
	if (values.balancerTag) {
		rule.balancerTag = values.balancerTag;
	} else if (values.outboundTag) {
		rule.outboundTag = values.outboundTag;
	}
	if (values.inboundTags.length) rule.inboundTag = values.inboundTags;
	if (values.networks.length) rule.network = values.networks;
	if (values.protocols.length) rule.protocol = values.protocols;

	const source = splitStringList(values.sourceIps);
	if (source.length) rule.source = source;

	const sourcePort = splitStringList(values.sourcePort);
	if (sourcePort.length) rule.sourcePort = sourcePort;

	const domain = splitStringList(values.domain);
	if (domain.length) rule.domain = domain;

	const ip = splitStringList(values.ip);
	if (ip.length) rule.ip = ip;

	const user = splitStringList(values.user);
	if (user.length) rule.user = user;

	const portValue = values.port.trim();
	if (portValue) rule.port = portValue;

	if (values.attrs.length) {
		const attrs: Record<string, string> = {};
		values.attrs.forEach(({ key, value }) => {
			if (!key.trim()) return;
			attrs[key.trim()] = value;
		});
		if (Object.keys(attrs).length) {
			rule.attrs = attrs;
		}
	}

	if (!rule.type) {
		rule.type = "field";
	}

	return rule;
};

export const RuleModal: FC<RuleModalProps> = ({
	isOpen,
	mode,
	initialRule,
	availableInboundTags,
	availableOutboundTags,
	availableBalancerTags,
	onSubmit,
	onClose,
}) => {
	const { t } = useTranslation();

	const {
		control,
		register,
		handleSubmit,
		reset,
		setValue,
		formState: { isSubmitting },
	} = useForm<RuleFormValues>({
		defaultValues: defaultFormValues,
	});

	const { fields, append, remove } = useFieldArray({
		control,
		name: "attrs",
	});

	useEffect(() => {
		if (isOpen) {
			reset(ruleToFormValues(initialRule));
		}
	}, [isOpen, initialRule, reset]);

	const onAddAttribute = () => append({ key: "", value: "" });

	const handleClose = () => {
		onClose();
	};

	const handleSave = handleSubmit((values) => {
		const rule = formValuesToRule(values);
		onSubmit(rule);
		handleClose();
	});

	const title = useMemo(
		() =>
			mode === "edit"
				? t("pages.xray.rules.edit")
				: t("pages.xray.rules.add"),
		[mode, t],
	);

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			size="3xl"
			scrollBehavior="inside"
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent as="form" onSubmit={handleSave}>
				<XrayModalHeader>{title}</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<Stack spacing={3}>
						<XrayDialogSection
							title={t("pages.outbound.basicSettings")}
						>
							<Stack spacing={3}>
								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.type")}
									</FormLabel>
									<Controller
										control={control}
										name="type"
										render={({ field }) => (
											<SearchableTagSelect
												mode="single"
												options={TYPE_OPTIONS}
												value={field.value ?? ""}
												onChange={(value) => field.onChange(value as string)}
												placeholder={t("pages.xray.rules.type")}
												searchPlaceholder={t("search")}
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.outboundTag")}
									</FormLabel>
									<Controller
										control={control}
										name="outboundTag"
										render={({ field }) => (
											<HStack align="start">
												<Box flex="1" minW={0}>
													<SearchableTagSelect
														mode="single"
														options={availableOutboundTags}
														value={field.value ?? ""}
														onChange={(value) => {
															const nextValue = value as string;
															field.onChange(nextValue);
															if (nextValue) {
																setValue("balancerTag", "", { shouldDirty: true });
															}
														}}
														placeholder={t("userDialog.flow.none")}
														searchPlaceholder={t("search")}
														emptyText={t("pages.xray.outbound.empty")}
													/>
												</Box>
												<IconButton
													aria-label={t("remove")}
													icon={<XMarkIcon />}
													size="sm"
													variant="ghost"
													isDisabled={!field.value}
													onClick={() => field.onChange("")}
												/>
											</HStack>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.balancer")}
									</FormLabel>
									<Controller
										control={control}
										name="balancerTag"
										render={({ field }) => (
											<HStack align="start">
												<Box flex="1" minW={0}>
													<SearchableTagSelect
														mode="single"
														options={availableBalancerTags}
														value={field.value ?? ""}
														onChange={(value) => {
															const nextValue = value as string;
															field.onChange(nextValue);
															if (nextValue) {
																setValue("outboundTag", "", { shouldDirty: true });
															}
														}}
														placeholder={t("userDialog.flow.none")}
														searchPlaceholder={t("search")}
														emptyText={t("pages.xray.balancer.empty")}
													/>
												</Box>
												<IconButton
													aria-label={t("remove")}
													icon={<XMarkIcon />}
													size="sm"
													variant="ghost"
													isDisabled={!field.value}
													onClick={() => field.onChange("")}
												/>
											</HStack>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.inboundTag")}
									</FormLabel>
									<Controller
										control={control}
										name="inboundTags"
										render={({ field }) => (
											<SearchableTagSelect
												mode="multiple"
												options={availableInboundTags}
												value={field.value ?? []}
												onChange={(value) => field.onChange(value as string[])}
												placeholder={t("pages.xray.rules.inboundTag")}
												searchPlaceholder={t("search")}
												emptyText={t("pages.inbounds.empty")}
											/>
										)}
									/>
								</FormControl>
							</Stack>
						</XrayDialogSection>

						<XrayDialogSection title={t("pages.xray.Routings")}>
							<Stack spacing={3}>
								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.domainMatcher")}
									</FormLabel>
									<Controller
										control={control}
										name="domainMatcher"
										render={({ field }) => (
											<SearchableTagSelect
												mode="single"
												options={DOMAIN_MATCHER_OPTIONS.map((option) => ({
													value: option,
													label: option || t("common.default"),
												}))}
												value={field.value ?? ""}
												onChange={(value) => field.onChange(value as string)}
												placeholder={t("common.default")}
												searchPlaceholder={t("search")}
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.network")}
									</FormLabel>
									<Controller
										control={control}
										name="networks"
										render={({ field }) => (
											<CheckboxGroup {...field}>
												<Wrap spacing={3}>
													{NETWORK_OPTIONS.map((network) => (
														<WrapItem key={network}>
															<Checkbox value={network}>{network}</Checkbox>
														</WrapItem>
													))}
												</Wrap>
											</CheckboxGroup>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.protocol")}
									</FormLabel>
									<Controller
										control={control}
										name="protocols"
										render={({ field }) => (
											<CheckboxGroup {...field}>
												<Wrap spacing={3}>
													{PROTOCOL_OPTIONS.map((protocol) => (
														<WrapItem key={protocol}>
															<Checkbox value={protocol}>{protocol}</Checkbox>
														</WrapItem>
													))}
												</Wrap>
											</CheckboxGroup>
										)}
									/>
								</FormControl>
							</Stack>
						</XrayDialogSection>

						<XrayDialogSection
							title={t("pages.xray.rules.sourceGroup")}
						>
							<XrayFieldGrid>
								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.source")}
									</FormLabel>
									<Controller
										control={control}
										name="sourceIps"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder={t("pages.xray.rules.useComma")}
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.sourcePort")}
									</FormLabel>
									<Controller
										control={control}
										name="sourcePort"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder="80, 443, 1000-2000"
											/>
										)}
									/>
								</FormControl>
							</XrayFieldGrid>
						</XrayDialogSection>

						<XrayDialogSection
							title={t("pages.xray.rules.destinationGroup")}
						>
							<XrayFieldGrid>
								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.ip")}
									</FormLabel>
									<Controller
										control={control}
										name="ip"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder="8.8.8.8, geoip:private"
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>
										{t("pages.xray.rules.domain")}
									</FormLabel>
									<Controller
										control={control}
										name="domain"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder="domain:example.com, geosite:category-ads"
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>{t("users")}</FormLabel>
									<Controller
										control={control}
										name="user"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder="email@example.com, user-tag"
											/>
										)}
									/>
								</FormControl>

								<FormControl>
									<FormLabel>{t("pages.xray.rules.port")}</FormLabel>
									<Controller
										control={control}
										name="port"
										render={({ field }) => (
											<MultiValueAutocomplete
												value={field.value ?? ""}
												onChange={field.onChange}
												placeholder="80, 443, 1000-2000"
											/>
										)}
									/>
								</FormControl>
							</XrayFieldGrid>
						</XrayDialogSection>

						<XrayDialogSection
							title={t("pages.xray.rules.attrs")}
						>
							<FormControl>
								<FormLabel>
									{t("pages.xray.rules.attrs")}
								</FormLabel>
								<Button
									onClick={onAddAttribute}
									size="xs"
									leftIcon={<PlusIcon width={16} />}
									variant="outline"
									colorScheme="primary"
								>
									{t("add")}
								</Button>
							</FormControl>
							<Stack spacing={2} mt={3}>
								{fields.length === 0 && (
									<Text fontSize="sm" color="gray.500">
										{t("pages.xray.rules.attrsHelper")}
									</Text>
								)}
								{fields.map((field, index) => (
									<HStack key={field.id} spacing={2} align="flex-start">
										<Input
											size="sm"
											placeholder={t("myaccount.apiKeyMasked")}
											{...register(`attrs.${index}.key` as const)}
										/>
										<Input
											size="sm"
											placeholder={t("value")}
											{...register(`attrs.${index}.value` as const)}
										/>
										<IconButton
											aria-label={t("a11y.removeAttribute")}
											icon={<XMarkIcon width={16} />}
											size="sm"
											variant="ghost"
											onClick={() => remove(index)}
										/>
									</HStack>
								))}
							</Stack>
						</XrayDialogSection>
					</Stack>
				</XrayModalBody>
				<XrayModalFooter justifyContent="flex-end">
					<Button variant="outline" onClick={handleClose}>
						{t("cancel")}
					</Button>
					<Button colorScheme="primary" type="submit" isLoading={isSubmitting}>
						{mode === "edit"
							? t("pages.xray.rules.edit")
							: t("pages.xray.rules.add")}
					</Button>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
