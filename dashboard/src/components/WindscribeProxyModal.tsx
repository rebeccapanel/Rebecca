import {
	Alert,
	AlertIcon,
	Box,
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { countryCodeFromEnglishName, countryFlag } from "../utils/countries";
import {
	MultiValueAutocomplete,
	splitMultiValueText,
	type MultiValueAutocompleteOption,
} from "./common/MultiValueAutocomplete";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type WindscribeProxyFormValues = {
	username: string;
	password: string;
	location: string;
	port: number;
	tag: string;
};

type WindscribeLocation = {
	name: string;
	available: boolean;
};

type Props = {
	isOpen: boolean;
	isLoading: boolean;
	isMasterTarget: boolean;
	targetID: string;
	onClose: () => void;
	onSubmit: (values: WindscribeProxyFormValues) => Promise<void>;
};

const defaults: WindscribeProxyFormValues = {
	username: "",
	password: "",
	location: "",
	port: 18888,
	tag: "windscribe",
};

const errorDetail = (error: any, fallback: string) => {
	const detail =
		error?.response?._data?.detail ??
		error?.data?.detail ??
		error?.message ??
		fallback;
	return typeof detail === "string" ? detail : JSON.stringify(detail);
};

export const WindscribeProxyModal: FC<Props> = ({
	isOpen,
	isLoading,
	isMasterTarget,
	targetID,
	onClose,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const form = useForm<WindscribeProxyFormValues>({ defaultValues: defaults });
	const [isLoadingLocations, setIsLoadingLocations] = useState(false);
	const [locationOptions, setLocationOptions] = useState<
		MultiValueAutocompleteOption[]
	>([]);
	const [loadError, setLoadError] = useState("");

	useEffect(() => {
		if (!isOpen) return;
		form.reset(defaults);
		setLocationOptions([]);
		setLoadError("");
	}, [form, isOpen]);

	const loadLocations = async () => {
		if (!(await form.trigger(["username", "password"]))) return;
		setIsLoadingLocations(true);
		setLoadError("");
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: { locations?: WindscribeLocation[] };
				msg?: string;
			}>("/panel/xray/windscribe/locations", {
				method: "POST",
				body: {
					target_id: targetID,
					username: form.getValues("username").trim(),
					password: form.getValues("password"),
				},
			});
			if (!response?.success) {
				throw new Error(
					response?.msg || t("pages.xray.windscribe.locationsFailed"),
				);
			}
			const options = (response.obj?.locations ?? []).flatMap((location) => {
				const code = countryCodeFromEnglishName(location.name);
				if (!code) return [];
				return [
					{
						disabled: !location.available,
						label: `${countryFlag(code)} ${code} - ${location.name}${location.available ? "" : " (Pro)"}`,
						searchLabel: `${code} ${location.name}`,
						title: location.name,
						value: code,
					},
				];
			});
			if (options.length === 0) {
				throw new Error(t("pages.xray.windscribe.noLocations"));
			}
			setLocationOptions(options);
			form.setValue("location", "", { shouldValidate: true });
		} catch (error: any) {
			setLocationOptions([]);
			setLoadError(
				errorDetail(
					error,
					t(
						"pages.xray.windscribe.locationsFailed",
						"Unable to load Windscribe locations",
					),
				),
			);
		} finally {
			setIsLoadingLocations(false);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="xl"
			isCentered
			closeOnEsc={!isLoading && !isLoadingLocations}
			closeOnOverlayClick={!isLoading && !isLoadingLocations}
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
					<XrayModalHeader subtitle={t("pages.xray.windscribe.description")}>
						{t("pages.xray.windscribe.title", "Set up Windscribe outbound")}
					</XrayModalHeader>
					<ModalCloseButton isDisabled={isLoading || isLoadingLocations} />
					<XrayModalBody flex="1" minH={0} overflowY="auto">
						<VStack spacing={3} align="stretch">
							{isMasterTarget && (
								<Alert status="warning" borderRadius="sm" fontSize="sm">
									<AlertIcon />
									{t("pages.xray.windscribe.nodeRequired")}
								</Alert>
							)}
							<XrayDialogSection
								title={t("pages.xray.windscribe.account", "Windscribe account")}
							>
								<XrayFieldGrid>
									<FormControl
										isInvalid={Boolean(form.formState.errors.username)}
									>
										<FormLabel>{t("username")}</FormLabel>
										<Input
											autoComplete="username"
											{...form.register("username", {
												required: t("pages.xray.windscribe.usernameRequired"),
												minLength: {
													value: 3,
													message: t("pages.xray.windscribe.usernameRequired"),
												},
												maxLength: 128,
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.username?.message}
										</FormErrorMessage>
									</FormControl>
									<FormControl
										isInvalid={Boolean(form.formState.errors.password)}
									>
										<FormLabel>{t("password")}</FormLabel>
										<Input
											type="password"
											autoComplete="current-password"
											{...form.register("password", {
												required: t("pages.xray.windscribe.passwordRequired"),
												minLength: {
													value: 8,
													message: t("pages.xray.windscribe.passwordRequired"),
												},
												maxLength: 256,
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.password?.message}
										</FormErrorMessage>
									</FormControl>
								</XrayFieldGrid>
								<Button
									mt={3}
									size="sm"
									type="button"
									variant="outline"
									isLoading={isLoadingLocations}
									isDisabled={isMasterTarget || isLoading}
									onClick={loadLocations}
								>
									{t(
										"pages.xray.windscribe.loadLocations",
										"Login and load locations",
									)}
								</Button>
								{loadError && (
									<Alert mt={3} status="error" borderRadius="sm" fontSize="sm">
										<AlertIcon />
										{loadError}
									</Alert>
								)}
							</XrayDialogSection>

							<XrayDialogSection
								title={t("pages.xray.windscribe.proxy", "Proxy outbound")}
							>
								<FormControl
									isInvalid={Boolean(form.formState.errors.location)}
								>
									<FormLabel>
										{t("pages.xray.windscribe.location", "Location")}
									</FormLabel>
									<Controller
										name="location"
										control={form.control}
										rules={{
											validate: (value) =>
												splitMultiValueText(value).length === 1 ||
												t("pages.xray.windscribe.locationRequired"),
										}}
										render={({ field }) => (
											<MultiValueAutocomplete
												allowCustom={false}
												isDisabled={locationOptions.length === 0}
												maxValues={1}
												options={locationOptions}
												placeholder={t("pages.xray.windscribe.selectLocation")}
												value={field.value}
												onChange={field.onChange}
											/>
										)}
									/>
									<FormHelperText>
										{t("pages.xray.windscribe.singleLocationHint")}
									</FormHelperText>
									<FormErrorMessage>
										{form.formState.errors.location?.message}
									</FormErrorMessage>
								</FormControl>
								<XrayFieldGrid mt={3}>
									<FormControl isInvalid={Boolean(form.formState.errors.port)}>
										<FormLabel>
											{t("pages.xray.windscribe.port", "SOCKS port")}
										</FormLabel>
										<Input
											type="number"
											inputMode="numeric"
											{...form.register("port", {
												valueAsNumber: true,
												min: {
													value: 1024,
													message: t("pages.xray.windscribe.portInvalid"),
												},
												max: {
													value: 65535,
													message: t("pages.xray.windscribe.portInvalid"),
												},
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.port?.message}
										</FormErrorMessage>
									</FormControl>
									<FormControl isInvalid={Boolean(form.formState.errors.tag)}>
										<FormLabel>
											{t("pages.xray.windscribe.tag", "Outbound tag")}
										</FormLabel>
										<Input
											{...form.register("tag", {
												required: t("pages.xray.windscribe.tagRequired"),
												pattern: {
													value: /^[a-zA-Z0-9_.-]+$/,
													message: t("pages.xray.windscribe.tagInvalid"),
												},
											})}
										/>
										<FormErrorMessage>
											{form.formState.errors.tag?.message}
										</FormErrorMessage>
									</FormControl>
								</XrayFieldGrid>
							</XrayDialogSection>
						</VStack>
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button
							variant="outline"
							onClick={onClose}
							isDisabled={isLoading || isLoadingLocations}
						>
							{t("cancel")}
						</Button>
						<Button
							type="submit"
							colorScheme="primary"
							isLoading={isLoading}
							isDisabled={
								isMasterTarget ||
								locationOptions.length === 0 ||
								isLoadingLocations
							}
						>
							{t("pages.xray.windscribe.start", "Set up outbound")}
						</Button>
					</XrayModalFooter>
				</Box>
			</XrayModalContent>
		</Modal>
	);
};
