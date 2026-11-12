import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { FormSection } from "components/ui/form-section";
import { Input as UiInput } from "components/ui/input";
import { SegmentedControl } from "components/ui/segmented-control";
import { ArrowLeftRight } from "lucide-react";
import { type FC, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { useTranslation } from "react-i18next";
import {
	SearchableTagSelect,
	type SearchableTagSelectOption,
} from "./common/SearchableTagSelect";
import { OutboundTestButton } from "./xray/OutboundTestButton";

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
	open: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialReverse?: ReverseFormValues | null;
	inboundTags: string[];
	outboundTags: string[];
	outboundOptions?: SearchableTagSelectOption[];
	vlessInboundTags: string[];
	vlessOutboundTags: string[];
	vlessOutboundOptions?: SearchableTagSelectOption[];
	vlessOutboundDetails: Record<string, { credentialId: string; flow: string }>;
	existingTags: string[];
	reverseCount: number;
	onTestOutbound?: (tag: string) => void;
	outboundTestingByTag?: Record<string, boolean>;
	onSubmit: (values: ReverseFormValues) => void;
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reverseShell =
	"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

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
	open: isOpen,
	onClose,
	mode,
	initialReverse,
	inboundTags,
	outboundTags,
	outboundOptions,
	vlessInboundTags,
	vlessOutboundTags,
	vlessOutboundOptions,
	vlessOutboundDetails,
	existingTags,
	reverseCount,
	onTestOutbound,
	outboundTestingByTag = {},
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
		<Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
			<DialogContent className={reverseShell}>
				<form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<ArrowLeftRight className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{mode === "edit" ? t("pages.xray.reverse.edit") : t("pages.xray.reverse.add")}
							</DialogTitle>
							<DialogDescription className="truncate">{t("pages.xray.reverse.title")}</DialogDescription>
						</div>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
						<div className="flex flex-col gap-5">
							<FormSection title={t("pages.xray.reverse.connection")}>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<FormField label={t("pages.xray.reverse.role")}>
										<SegmentedControl<ReverseType>
											label={t("pages.xray.reverse.role")}
											value={type}
											options={[
												{ value: "internal", label: t("pages.xray.reverse.internal") },
												{ value: "public", label: t("pages.xray.reverse.public") },
											]}
											onChange={(value) => form.setValue("type", value, { shouldDirty: true })}
										/>
									</FormField>
									<FormField
										label={t("pages.xray.reverse.tag")}
										error={tagInvalid ? (duplicateTag ? t("pages.xray.reverse.tagDuplicate") : t("pages.xray.reverse.tagError")) : undefined}
										description={!tagInvalid ? (type === "public" ? t("pages.xray.reverse.tagPendingHint") : t("pages.xray.reverse.tagHint")) : undefined}
									>
										<Controller
											control={form.control}
											name="tag"
											render={({ field }) => (
												<EmojiShortcodeInput
													ref={field.ref}
													value={field.value ?? ""}
													onChange={field.onChange}
													onBlur={field.onBlur}
													placeholder="reverse-1"
													autoComplete="off"
												/>
											)}
										/>
									</FormField>
								</div>
							</FormSection>

							{type === "internal" ? (
								<FormSection>
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={t("pages.xray.reverse.vlessOutbound")} error={!connectionOutbound ? t("pages.xray.reverse.vlessOutboundRequired") : undefined}>
											<SearchableTagSelect
												mode="single"
												options={vlessOutboundOptions ?? vlessOutboundTags}
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
												rightElement={
													<OutboundTestButton
														label={t("pages.xray.routeTester.test")}
														tag={connectionOutbound}
														isTesting={outboundTestingByTag[connectionOutbound]}
														onTest={onTestOutbound}
													/>
												}
											/>
										</FormField>
										<FormField label={t("pages.xray.reverse.target")} error={!targetOutbound ? t("pages.xray.reverse.targetRequired") : undefined}>
											<SearchableTagSelect
												mode="single"
												options={(outboundOptions ?? outboundTags).filter(
													(option) =>
														(typeof option === "string"
															? option
															: option.value) !== connectionOutbound,
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
												rightElement={
													<OutboundTestButton
														label={t("pages.xray.routeTester.test")}
														tag={targetOutbound}
														isTesting={outboundTestingByTag[targetOutbound]}
														onTest={onTestOutbound}
													/>
												}
											/>
										</FormField>
										{connectionDetails && (
											<>
												<FormField label={t("pages.xray.reverse.credentialId")} description={t("pages.xray.reverse.pairingHint")}>
													<UiInput value={connectionDetails.credentialId} readOnly className="font-mono" />
												</FormField>
												<FormField label={t("userDialog.flow.label")}>
													<UiInput value={connectionDetails.flow || t("userDialog.flow.none")} readOnly />
												</FormField>
											</>
										)}
									</div>
								</FormSection>
							) : (
								<FormSection>
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={t("pages.xray.reverse.vlessInbound")} error={!connectionInbound ? t("pages.xray.reverse.vlessInboundRequired") : undefined}>
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
										</FormField>
										<FormField
											label={t("pages.xray.reverse.credentialId")}
											error={credentialInvalid ? t("pages.xray.reverse.credentialIdError") : undefined}
											description={!credentialInvalid ? t("pages.xray.reverse.pairingHint") : undefined}
										>
											<UiInput {...form.register("credentialId")} className="font-mono" autoComplete="off" />
										</FormField>
										<FormField label={t("userDialog.flow.label")}>
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
										</FormField>
										<FormField label={t("pages.xray.reverse.sourceInbounds")} error={!sourceInbounds.length ? t("pages.xray.reverse.inboundRequired") : undefined}>
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
										</FormField>
									</div>
								</FormSection>
							)}
						</div>
					</div>
					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={onClose} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={!isValid} size="sm">
							{mode === "edit" ? t("save") : t("add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
