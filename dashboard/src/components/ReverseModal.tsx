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
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type ReverseType = "internal" | "public";

export type ReverseFormValues = {
	type: ReverseType;
	tag: string;
	credentialId: string;
	flow: string;
	interconnectionOutboundTag: string;
	outboundTag: string;
	interconnectionInboundTag: string;
	inboundTags: string[];
};

interface ReverseModalProps {
	isOpen: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialReverse?: ReverseFormValues | null;
	inboundTags: string[];
	outboundTags: string[];
	vlessInboundTags: string[];
	vlessOutboundTags: string[];
	vlessOutboundDetails: Record<string, { credentialId: string; flow: string }>;
	existingTags: string[];
	reverseCount: number;
	onSubmit: (values: ReverseFormValues) => void;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultValues = (reverseCount: number): ReverseFormValues => ({
	type: "internal",
	tag: `reverse-${reverseCount + 1}`,
	credentialId:
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: "",
	flow: "",
	interconnectionOutboundTag: "",
	outboundTag: "",
	interconnectionInboundTag: "",
	inboundTags: [],
});

export const ReverseModal: FC<ReverseModalProps> = ({
	isOpen,
	onClose,
	mode,
	initialReverse,
	inboundTags,
	outboundTags,
	vlessInboundTags,
	vlessOutboundTags,
	vlessOutboundDetails,
	existingTags,
	reverseCount,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const form = useForm<ReverseFormValues>({
		defaultValues: defaultValues(reverseCount),
	});

	useEffect(() => {
		if (!isOpen) return;
		form.reset(
			initialReverse
				? { ...defaultValues(reverseCount), ...initialReverse }
				: defaultValues(reverseCount),
		);
	}, [form, initialReverse, isOpen, reverseCount]);

	const type = form.watch("type");
	const tag = form.watch("tag");
	const credentialId = form.watch("credentialId");
	const connectionOutbound = form.watch("interconnectionOutboundTag");
	const connectionDetails = vlessOutboundDetails[connectionOutbound];
	const targetOutbound = form.watch("outboundTag");
	const connectionInbound = form.watch("interconnectionInboundTag");
	const sourceInbounds = form.watch("inboundTags") ?? [];
	const duplicateTag = existingTags.includes(tag.trim());
	const tagInvalid = !tag.trim() || duplicateTag;
	const credentialInvalid =
		type === "public" && !uuidPattern.test(credentialId.trim());
	const isValid =
		!tagInvalid &&
		!credentialInvalid &&
		(type === "internal"
			? Boolean(connectionOutbound && targetOutbound)
			: Boolean(connectionInbound && sourceInbounds.length));

	const submit = form.handleSubmit((values) => {
		if (!isValid) return;
		onSubmit({
			...values,
			tag: values.tag.trim(),
			credentialId: values.credentialId.trim(),
			flow: values.flow.trim(),
			inboundTags: values.inboundTags ?? [],
		});
	});

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3">
				<XrayModalHeader>
					{mode === "edit"
						? t("pages.xray.reverse.edit", "Edit reverse proxy")
						: t("pages.xray.reverse.add", "Add reverse proxy")}
				</XrayModalHeader>
				<ModalCloseButton />
				<form onSubmit={submit}>
					<XrayModalBody>
						<VStack spacing={4} align="stretch">
							<XrayDialogSection
								title={t("pages.xray.reverse.connection", "Connection")}
							>
								<XrayFieldGrid>
									<FormControl>
										<FormLabel>
											{t("pages.xray.reverse.role", "Server role")}
										</FormLabel>
										<SearchableTagSelect
											mode="single"
											options={[
												{
													value: "internal",
													label: t(
														"pages.xray.reverse.internal",
														"Internal device",
													),
												},
												{
													value: "public",
													label: t(
														"pages.xray.reverse.public",
														"Public server",
													),
												},
											]}
											value={type}
											onChange={(value) =>
												form.setValue("type", value as ReverseType, {
													shouldDirty: true,
												})
											}
											placeholder={t("pages.xray.reverse.role", "Server role")}
											searchPlaceholder={t("search", "Search")}
										/>
									</FormControl>
									<FormControl isInvalid={tagInvalid}>
										<FormLabel>{t("pages.xray.reverse.tag", "Tag")}</FormLabel>
										<Input {...form.register("tag")} size="sm" placeholder="reverse-1" />
										{tagInvalid ? (
											<FormErrorMessage>
												{duplicateTag
													? t(
															"pages.xray.reverse.tagDuplicate",
															"This tag is already in use.",
														)
													: t(
															"pages.xray.reverse.tagError",
															"Enter a reverse tag.",
														)}
											</FormErrorMessage>
										) : (
											<FormHelperText>
												{type === "public"
													? t(
															"pages.xray.reverse.tagPendingHint",
															"Xray activates this tag after the internal device connects.",
														)
													: t(
															"pages.xray.reverse.tagHint",
															"Xray creates this tag locally.",
														)}
											</FormHelperText>
										)}
									</FormControl>
								</XrayFieldGrid>
							</XrayDialogSection>

							{type === "internal" ? (
								<XrayDialogSection
									title={t(
										"pages.xray.reverse.internal",
										"Internal device",
									)}
								>
									<XrayFieldGrid>
										<FormControl isInvalid={!connectionOutbound}>
											<FormLabel>
												{t(
													"pages.xray.reverse.vlessOutbound",
													"VLESS connection",
												)}
											</FormLabel>
											<SearchableTagSelect
												mode="single"
												options={vlessOutboundTags}
												value={connectionOutbound}
												onChange={(value) =>
													form.setValue(
														"interconnectionOutboundTag",
														value as string,
														{ shouldDirty: true },
													)
												}
												placeholder={t(
													"pages.xray.reverse.selectVlessOutbound",
													"Select a VLESS outbound",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.xray.reverse.noVlessOutbound",
													"No compatible VLESS outbound",
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.vlessOutboundRequired",
													"Select the VLESS connection.",
												)}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={!targetOutbound}>
											<FormLabel>
												{t("pages.xray.reverse.target", "Target outbound")}
											</FormLabel>
											<SearchableTagSelect
												mode="single"
												options={outboundTags.filter(
													(tag) => tag !== connectionOutbound,
												)}
												value={targetOutbound}
												onChange={(value) =>
													form.setValue("outboundTag", value as string, {
														shouldDirty: true,
													})
												}
												placeholder={t(
													"pages.xray.reverse.selectTargetOutbound",
													"Select a target outbound",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.xray.reverse.noTargetOutbound",
													"No target outbound",
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.targetRequired",
													"Select the target outbound.",
												)}
											</FormErrorMessage>
										</FormControl>
										{connectionDetails && (
											<>
												<FormControl>
													<FormLabel>
														{t("pages.xray.reverse.credentialId", "Connection UUID")}
													</FormLabel>
													<Input
														value={connectionDetails.credentialId}
														isReadOnly
														fontFamily="mono"
														size="sm"
													/>
													<FormHelperText>
														{t(
															"pages.xray.reverse.pairingHint",
															"UUID and Flow must match the internal VLESS outbound.",
														)}
													</FormHelperText>
												</FormControl>
												<FormControl>
													<FormLabel>{t("pages.outbound.flow", "Flow")}</FormLabel>
													<Input
														value={connectionDetails.flow || t("common.none", "None")}
														isReadOnly
														size="sm"
													/>
												</FormControl>
											</>
										)}
									</XrayFieldGrid>
								</XrayDialogSection>
							) : (
								<XrayDialogSection
									title={t("pages.xray.reverse.public", "Public server")}
								>
									<XrayFieldGrid>
										<FormControl isInvalid={!connectionInbound}>
											<FormLabel>
												{t(
													"pages.xray.reverse.vlessInbound",
													"VLESS connection",
												)}
											</FormLabel>
											<SearchableTagSelect
												mode="single"
												options={vlessInboundTags}
												value={connectionInbound}
												onChange={(value) =>
													form.setValue(
														"interconnectionInboundTag",
														value as string,
														{ shouldDirty: true },
													)
												}
												placeholder={t(
													"pages.xray.reverse.selectVlessInbound",
													"Select a VLESS inbound",
												)}
												searchPlaceholder={t("search", "Search")}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.vlessInboundRequired",
													"Select the VLESS connection.",
												)}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={credentialInvalid}>
											<FormLabel>
												{t("pages.xray.reverse.credentialId", "Connection UUID")}
											</FormLabel>
											<Input {...form.register("credentialId")} size="sm" fontFamily="mono" />
											{credentialInvalid ? (
												<FormErrorMessage>
													{t(
														"pages.xray.reverse.credentialIdError",
														"Enter a valid UUID.",
													)}
												</FormErrorMessage>
											) : (
												<FormHelperText>
													{t(
														"pages.xray.reverse.pairingHint",
														"UUID and Flow must match the internal VLESS outbound.",
													)}
												</FormHelperText>
											)}
										</FormControl>
										<FormControl>
											<FormLabel>{t("pages.outbound.flow", "Flow")}</FormLabel>
											<SearchableTagSelect
												mode="single"
											options={[
												{ value: "", label: t("common.none", "None") },
												"xtls-rprx-vision",
											]}
												value={form.watch("flow")}
												onChange={(value) =>
													form.setValue("flow", value as string, {
														shouldDirty: true,
													})
												}
												placeholder={t("common.none", "None")}
												searchPlaceholder={t("search", "Search")}
											/>
										</FormControl>
										<FormControl isInvalid={!sourceInbounds.length}>
											<FormLabel>
												{t("pages.xray.reverse.sourceInbounds", "Source inbounds")}
											</FormLabel>
											<SearchableTagSelect
												mode="multiple"
												options={inboundTags.filter(
													(tag) => tag !== connectionInbound,
												)}
												value={sourceInbounds}
												onChange={(value) =>
													form.setValue("inboundTags", value as string[], {
														shouldDirty: true,
													})
												}
												placeholder={t(
													"pages.xray.reverse.selectSourceInbounds",
													"Select source inbounds",
												)}
												searchPlaceholder={t("search", "Search")}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.inboundRequired",
													"Select at least one source inbound.",
												)}
											</FormErrorMessage>
										</FormControl>
									</XrayFieldGrid>
								</XrayDialogSection>
							)}
						</VStack>
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button variant="outline" onClick={onClose}>
							{t("cancel")}
						</Button>
						<Button type="submit" colorScheme="primary" size="sm" isDisabled={!isValid}>
							{mode === "edit" ? t("save") : t("add")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Modal>
	);
};
