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
						? t("pages.xray.reverse.edit")
						: t("pages.xray.reverse.add")}
				</XrayModalHeader>
				<ModalCloseButton />
				<form onSubmit={submit}>
					<XrayModalBody>
						<VStack spacing={4} align="stretch">
							<XrayDialogSection
								title={t("pages.xray.reverse.connection")}
							>
								<XrayFieldGrid>
									<FormControl>
										<FormLabel>
											{t("pages.xray.reverse.role")}
										</FormLabel>
										<SearchableTagSelect
											mode="single"
											options={[
												{
													value: "internal",
													label: t("pages.xray.reverse.internal"),
												},
												{
													value: "public",
													label: t("pages.xray.reverse.public"),
												},
											]}
											value={type}
											onChange={(value) =>
												form.setValue("type", value as ReverseType, {
													shouldDirty: true,
												})
											}
											placeholder={t("pages.xray.reverse.role")}
											searchPlaceholder={t("search")}
										/>
									</FormControl>
									<FormControl isInvalid={tagInvalid}>
										<FormLabel>{t("pages.xray.reverse.tag")}</FormLabel>
										<Input {...form.register("tag")} size="sm" placeholder="reverse-1" />
										{tagInvalid ? (
											<FormErrorMessage>
												{duplicateTag
													? t("pages.xray.reverse.tagDuplicate")
													: t("pages.xray.reverse.tagError")}
											</FormErrorMessage>
										) : (
											<FormHelperText>
												{type === "public"
													? t("pages.xray.reverse.tagPendingHint")
													: t("pages.xray.reverse.tagHint")}
											</FormHelperText>
										)}
									</FormControl>
								</XrayFieldGrid>
							</XrayDialogSection>

							{type === "internal" ? (
								<XrayDialogSection
									title={t("pages.xray.reverse.internal")}
								>
									<XrayFieldGrid>
										<FormControl isInvalid={!connectionOutbound}>
											<FormLabel>
												{t("pages.xray.reverse.vlessOutbound")}
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
												placeholder={t("pages.xray.reverse.selectVlessOutbound")}
												searchPlaceholder={t("search")}
												emptyText={t("pages.xray.reverse.noVlessOutbound")}
											/>
											<FormErrorMessage>
												{t("pages.xray.reverse.vlessOutboundRequired")}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={!targetOutbound}>
											<FormLabel>
												{t("pages.xray.reverse.target")}
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
												placeholder={t("pages.xray.reverse.selectTargetOutbound")}
												searchPlaceholder={t("search")}
												emptyText={t("pages.xray.reverse.noTargetOutbound")}
											/>
											<FormErrorMessage>
												{t("pages.xray.reverse.targetRequired")}
											</FormErrorMessage>
										</FormControl>
										{connectionDetails && (
											<>
												<FormControl>
													<FormLabel>
														{t("pages.xray.reverse.credentialId")}
													</FormLabel>
													<Input
														value={connectionDetails.credentialId}
														isReadOnly
														fontFamily="mono"
														size="sm"
													/>
													<FormHelperText>
														{t("pages.xray.reverse.pairingHint")}
													</FormHelperText>
												</FormControl>
												<FormControl>
													<FormLabel>{t("userDialog.flow.label")}</FormLabel>
													<Input
														value={connectionDetails.flow || t("userDialog.flow.none")}
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
									title={t("pages.xray.reverse.public")}
								>
									<XrayFieldGrid>
										<FormControl isInvalid={!connectionInbound}>
											<FormLabel>
												{t("pages.xray.reverse.vlessInbound")}
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
												placeholder={t("pages.xray.reverse.selectVlessInbound")}
												searchPlaceholder={t("search")}
											/>
											<FormErrorMessage>
												{t("pages.xray.reverse.vlessInboundRequired")}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={credentialInvalid}>
											<FormLabel>
												{t("pages.xray.reverse.credentialId")}
											</FormLabel>
											<Input {...form.register("credentialId")} size="sm" fontFamily="mono" />
											{credentialInvalid ? (
												<FormErrorMessage>
													{t("pages.xray.reverse.credentialIdError")}
												</FormErrorMessage>
											) : (
												<FormHelperText>
													{t("pages.xray.reverse.pairingHint")}
												</FormHelperText>
											)}
										</FormControl>
										<FormControl>
											<FormLabel>{t("userDialog.flow.label")}</FormLabel>
											<SearchableTagSelect
												mode="single"
											options={[
												{ value: "", label: t("userDialog.flow.none") },
												"xtls-rprx-vision",
											]}
												value={form.watch("flow")}
												onChange={(value) =>
													form.setValue("flow", value as string, {
														shouldDirty: true,
													})
												}
												placeholder={t("userDialog.flow.none")}
												searchPlaceholder={t("search")}
											/>
										</FormControl>
										<FormControl isInvalid={!sourceInbounds.length}>
											<FormLabel>
												{t("pages.xray.reverse.sourceInbounds")}
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
												placeholder={t("pages.xray.reverse.selectSourceInbounds")}
												searchPlaceholder={t("search")}
											/>
											<FormErrorMessage>
												{t("pages.xray.reverse.inboundRequired")}
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
