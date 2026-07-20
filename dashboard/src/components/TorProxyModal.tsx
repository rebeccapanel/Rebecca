import {
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Switch,
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
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
	country: string;
	port: number;
	tag: string;
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
	country: "de",
	port: 9050,
	tag: "tor-de",
	strict: true,
};

export const TorProxyModal: FC<TorProxyModalProps> = ({
	isOpen,
	isLoading,
	isMasterTarget,
	onClose,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const form = useForm<TorProxyFormValues>({ defaultValues: defaults });

	useEffect(() => {
		if (isOpen) form.reset(defaults);
	}, [form, isOpen]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="lg"
			isCentered
			closeOnEsc={!isLoading}
			closeOnOverlayClick={!isLoading}
		>
			<ModalOverlay />
			<XrayModalContent>
				<form onSubmit={form.handleSubmit(onSubmit)}>
					<XrayModalHeader
						subtitle={
							isMasterTarget
								? t(
										"pages.xray.tor.descriptionAll",
										"Install and configure the same Tor SOCKS proxy on every active node.",
									)
								: t(
										"pages.xray.tor.description",
										"Install Tor on the selected node and add its local SOCKS proxy as an outbound.",
									)
						}
					>
						{t("pages.xray.tor.title", "Set up Tor outbound")}
					</XrayModalHeader>
					<ModalCloseButton isDisabled={isLoading} />
					<XrayModalBody>
						<VStack spacing={3} align="stretch">
							<XrayDialogSection>
								<XrayFieldGrid>
									<FormControl
										isInvalid={Boolean(form.formState.errors.country)}
									>
										<FormLabel>
											{t("pages.xray.tor.country", "Exit country")}
										</FormLabel>
										<Input
											maxLength={2}
											placeholder="de"
											textTransform="lowercase"
											{...form.register("country", {
												validate: (value) =>
													!value ||
													/^[a-zA-Z]{2}$/.test(value) ||
													t(
														"pages.xray.tor.countryInvalid",
														"Country must be a two-letter code.",
													),
											})}
										/>
										<FormHelperText>
											{t(
												"pages.xray.tor.countryHint",
												"ISO code, for example de. Leave empty for any exit.",
											)}
										</FormHelperText>
										<FormErrorMessage>
											{form.formState.errors.country?.message}
										</FormErrorMessage>
									</FormControl>
									<FormControl isInvalid={Boolean(form.formState.errors.port)}>
										<FormLabel>
											{t("pages.xray.tor.port", "SOCKS port")}
										</FormLabel>
										<Input
											type="number"
											inputMode="numeric"
											{...form.register("port", {
												valueAsNumber: true,
												required: t(
													"pages.xray.tor.portRequired",
													"Port is required.",
												),
												min: {
													value: 1024,
													message: t(
														"pages.xray.tor.portInvalid",
														"Port must be between 1024 and 65535.",
													),
												},
												max: {
													value: 65535,
													message: t(
														"pages.xray.tor.portInvalid",
														"Port must be between 1024 and 65535.",
													),
												},
											})}
										/>
										<FormHelperText>
											{t(
												"pages.xray.tor.portHint",
												"Localhost only; Xray connects to this port.",
											)}
										</FormHelperText>
										<FormErrorMessage>
											{form.formState.errors.port?.message}
										</FormErrorMessage>
									</FormControl>
								</XrayFieldGrid>
								<FormControl
									mt={3}
									isInvalid={Boolean(form.formState.errors.tag)}
								>
									<FormLabel>
										{t("pages.xray.tor.tag", "Outbound tag")}
									</FormLabel>
									<Input
										placeholder="tor-de"
										{...form.register("tag", {
											required: t(
												"pages.xray.tor.tagRequired",
												"Outbound tag is required.",
											),
											validate: (value) =>
												Boolean(value.trim()) ||
												t(
													"pages.xray.tor.tagRequired",
													"Outbound tag is required.",
												),
										})}
									/>
									<FormHelperText>
										{t(
											"pages.xray.tor.tagHint",
											"Use this tag in routing rules.",
										)}
									</FormHelperText>
									<FormErrorMessage>
										{form.formState.errors.tag?.message}
									</FormErrorMessage>
								</FormControl>
							</XrayDialogSection>
							<FormControl className="rb-dialog-switch-row">
								<FormLabel>
									{t("pages.xray.tor.strict", "Require selected exit country")}
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
				</form>
			</XrayModalContent>
		</Modal>
	);
};
