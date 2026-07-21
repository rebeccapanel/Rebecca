import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	HStack,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Switch,
	Text,
	Textarea,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { ArrowDownIcon, ArrowUpIcon } from "@heroicons/react/24/outline";
import { type FC, useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type TorProxyFormValues = {
	locations: string;
	startPort: number;
	portStep: number;
	direction: "up" | "down";
	tagPrefix: string;
	strict: boolean;
};

type TorProxyModalProps = {
	isOpen: boolean;
	isLoading: boolean;
	isMasterTarget: boolean;
	onClose: () => void;
	onSubmit: (values: TorProxyFormValues) => Promise<void>;
};

const defaults: TorProxyFormValues = {
	locations: "de",
	startPort: 9050,
	portStep: 1,
	direction: "up",
	tagPrefix: "tor",
	strict: true,
};

const parseLocations = (value: string) =>
	value
		.split(/[\s,;]+/)
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

export const TorProxyModal: FC<TorProxyModalProps> = ({
	isOpen,
	isLoading,
	isMasterTarget,
	onClose,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
	const form = useForm<TorProxyFormValues>({ defaultValues: defaults });
	const locationsValue = useWatch({ control: form.control, name: "locations" });
	const startPort = useWatch({ control: form.control, name: "startPort" });
	const portStep = useWatch({ control: form.control, name: "portStep" });
	const direction = useWatch({ control: form.control, name: "direction" });
	const tagPrefix = useWatch({ control: form.control, name: "tagPrefix" });
	const preview = useMemo(() => {
		const locations = parseLocations(locationsValue || "").slice(0, 20);
		const basePort = Number(startPort);
		const step = Number(portStep);
		return locations.map((country, index) => ({
			country,
			port:
				direction === "down"
					? basePort - index * step
					: basePort + index * step,
			tag: `${(tagPrefix || "tor").trim()}-${country}`,
		}));
	}, [direction, locationsValue, portStep, startPort, tagPrefix]);

	useEffect(() => {
		if (isOpen) form.reset(defaults);
	}, [form, isOpen]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="xl"
			isCentered
			closeOnEsc={!isLoading}
			closeOnOverlayClick={!isLoading}
		>
			<ModalOverlay />
			<XrayModalContent>
				<Box
					as="form"
					display="flex"
					flex="1"
					flexDirection="column"
					minH={0}
					overflow="hidden"
					onSubmit={form.handleSubmit(onSubmit)}
				>
					<XrayModalHeader
						subtitle={
							isMasterTarget
								? t(
										"pages.xray.tor.descriptionAll",
										"Create the selected Tor exits on every active node.",
									)
								: t(
										"pages.xray.tor.description",
										"Create one independent Tor SOCKS instance per exit location on the selected node.",
									)
						}
					>
						{t("pages.xray.tor.title", "Set up Tor outbounds")}
					</XrayModalHeader>
					<ModalCloseButton isDisabled={isLoading} />
					<XrayModalBody flex="1" minH={0} overflowY="auto">
						<VStack spacing={3} align="stretch">
							<XrayDialogSection>
								<FormControl
									isInvalid={Boolean(form.formState.errors.locations)}
								>
									<FormLabel>
										{t("pages.xray.tor.locations", "Exit locations")}
									</FormLabel>
									<Textarea
										minH="84px"
										resize="vertical"
										placeholder={"de\nnl\nus"}
										{...form.register("locations", {
											validate: (value) => {
												const locations = parseLocations(value);
												if (locations.length === 0) {
													return t(
														"pages.xray.tor.locationsRequired",
														"Enter at least one location.",
													);
												}
												if (locations.length > 20) {
													return t(
														"pages.xray.tor.locationsLimit",
														"Up to 20 locations can be added at once.",
													);
												}
												if (locations.some((item) => !/^[a-z]{2}$/i.test(item))) {
													return t(
														"pages.xray.tor.countryInvalid",
														"Each location must be a two-letter country code.",
													);
												}
												if (new Set(locations).size !== locations.length) {
													return t(
														"pages.xray.tor.locationsDuplicate",
														"Each location can only be added once.",
													);
												}
												return true;
											},
										})}
									/>
									<FormHelperText>
										{t(
											"pages.xray.tor.locationsHint",
											"Separate ISO country codes with commas, spaces, or new lines. Each location runs as a separate Tor instance.",
										)}
									</FormHelperText>
									<FormErrorMessage>
										{form.formState.errors.locations?.message}
									</FormErrorMessage>
								</FormControl>

								<XrayFieldGrid mt={3}>
									<FormControl
										isInvalid={Boolean(form.formState.errors.startPort)}
									>
										<FormLabel>
											{t("pages.xray.tor.startPort", "Starting SOCKS port")}
										</FormLabel>
										<Input
											type="number"
											inputMode="numeric"
											{...form.register("startPort", {
												valueAsNumber: true,
												required: t(
													"pages.xray.tor.portRequired",
													"Port is required.",
												),
												validate: (value) => {
													const count = Math.max(
														1,
														parseLocations(form.getValues("locations")).length,
													);
													const step = Number(form.getValues("portStep")) || 1;
													const end =
														form.getValues("direction") === "down"
															? value - (count - 1) * step
															: value + (count - 1) * step;
													return (
														(value >= 1024 && value <= 65535 && end >= 1024 && end <= 65535) ||
														t(
															"pages.xray.tor.generatedPortInvalid",
															"The generated port range must stay between 1024 and 65535.",
														)
													);
												},
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.startPort?.message}
										</FormErrorMessage>
									</FormControl>
									<FormControl>
										<FormLabel>
											{t("pages.xray.tor.direction", "Port direction")}
										</FormLabel>
										<Controller
											name="direction"
											control={form.control}
											render={({ field }) => (
												<ButtonGroup isAttached size="sm" w="full">
													<Button
														type="button"
														leftIcon={<ArrowUpIcon width={14} />}
														flex="1"
														variant={field.value === "up" ? "solid" : "outline"}
														colorScheme={field.value === "up" ? "primary" : "gray"}
														aria-pressed={field.value === "up"}
														onClick={() => field.onChange("up")}
													>
														{t("pages.xray.tor.directionUp", "Increase")}
													</Button>
													<Button
														type="button"
														leftIcon={<ArrowDownIcon width={14} />}
														flex="1"
														variant={field.value === "down" ? "solid" : "outline"}
														colorScheme={field.value === "down" ? "primary" : "gray"}
														aria-pressed={field.value === "down"}
														onClick={() => field.onChange("down")}
													>
														{t("pages.xray.tor.directionDown", "Decrease")}
													</Button>
												</ButtonGroup>
											)}
										/>
									</FormControl>
								</XrayFieldGrid>

								<XrayFieldGrid mt={3}>
									<FormControl
										isInvalid={Boolean(form.formState.errors.portStep)}
									>
										<FormLabel>{t("pages.xray.tor.portStep", "Port step")}</FormLabel>
										<Input
											type="number"
											inputMode="numeric"
											{...form.register("portStep", {
												valueAsNumber: true,
												min: {
													value: 1,
													message: t("pages.xray.tor.portStepInvalid", "Step must be between 1 and 1000."),
												},
												max: {
													value: 1000,
													message: t("pages.xray.tor.portStepInvalid", "Step must be between 1 and 1000."),
												},
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.portStep?.message}
										</FormErrorMessage>
									</FormControl>
									<FormControl
										isInvalid={Boolean(form.formState.errors.tagPrefix)}
									>
										<FormLabel>{t("pages.xray.tor.tagPrefix", "Tag prefix")}</FormLabel>
										<Input
											placeholder="tor"
											{...form.register("tagPrefix", {
												required: t("pages.xray.tor.tagRequired", "Tag prefix is required."),
												validate: (value) =>
													Boolean(value.trim()) ||
													t("pages.xray.tor.tagRequired", "Tag prefix is required."),
											})}
										/>
										<FormHelperText>
											{t("pages.xray.tor.tagPrefixHint", "The country code is appended automatically.")}
										</FormHelperText>
										<FormErrorMessage>
											{form.formState.errors.tagPrefix?.message}
										</FormErrorMessage>
									</FormControl>
								</XrayFieldGrid>

								<Box mt={4} pt={3} borderTopWidth="1px" borderColor={borderColor}>
									<HStack justify="space-between" mb={2}>
										<Text fontSize="xs" fontWeight="semibold">
											{t("pages.xray.tor.preview", "Generated outbounds")}
										</Text>
										<Badge variant="subtle">{preview.length}</Badge>
									</HStack>
									<VStack align="stretch" spacing={0} maxH="152px" overflowY="auto">
										{preview.map((item) => (
											<HStack
												key={item.country}
												justify="space-between"
												minH="34px"
												borderBottomWidth="1px"
												borderColor={borderColor}
												fontSize="xs"
											>
												<Text fontWeight="medium">{item.tag}</Text>
												<Text color="panel.textMuted" fontFamily="mono">
													127.0.0.1:{item.port}
												</Text>
											</HStack>
										))}
									</VStack>
								</Box>
							</XrayDialogSection>
							<FormControl className="rb-dialog-switch-row">
								<FormLabel>
									{t("pages.xray.tor.strict", "Require selected exit countries")}
								</FormLabel>
								<Controller
									name="strict"
									control={form.control}
									render={({ field }) => (
										<Switch
											isChecked={field.value}
											onChange={(event) => field.onChange(event.target.checked)}
										/>
									)}
								/>
							</FormControl>
						</VStack>
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button variant="outline" onClick={onClose} isDisabled={isLoading}>
							{t("cancel")}
						</Button>
						<Button
							type="submit"
							colorScheme="primary"
							isLoading={isLoading}
							loadingText={t("pages.xray.tor.starting", "Starting")}
						>
							{t("pages.xray.tor.start", "Start setup")}
						</Button>
					</XrayModalFooter>
				</Box>
			</XrayModalContent>
		</Modal>
	);
};
