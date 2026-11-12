import { Spinner } from "components/ui/spinner";
import { Checkbox } from "components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { CircleHelp } from "lucide-react";

import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type PropagationSection,
	type PropagationTarget,
	previewXrayPropagation,
	propagationKey,
} from "service/xrayPropagation";

export interface PropagationTargetsProps {
	source: string;
	section: PropagationSection;
	before: unknown | null;
	after: unknown | null;
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}

const statusMessageKeys = {
	missing: "pages.xray.propagate.missing",
	different: "pages.xray.propagate.different",
	conflict: "pages.xray.propagate.conflict",
} as const;

export const PropagationTargets: FC<PropagationTargetsProps> = ({
	source,
	section,
	before,
	after,
	selectedIds,
	onChange,
}) => {
	const { t } = useTranslation();
	const [targets, setTargets] = useState<PropagationTarget[] | null>(null);
	const requestKey = propagationKey({ source, section, before, after });

	useEffect(() => {
		const request = JSON.parse(requestKey);
		let active = true;
		setTargets(null);
		previewXrayPropagation(request)
			.then((result) => {
				if (active) setTargets(result);
			})
			.catch(() => {
				if (active) setTargets([]);
			});
		return () => {
			active = false;
		};
	}, [requestKey]);

	const enabledIds = useMemo(
		() =>
			(targets ?? [])
				.filter((target) => target.status === "ok")
				.map((target) => target.id),
		[targets],
	);

	useEffect(() => {
		if (!targets) return;
		const valid = selectedIds.filter((id) => enabledIds.includes(id));
		if (valid.length !== selectedIds.length) onChange(valid);
	}, [targets, enabledIds, selectedIds, onChange]);

	if (targets === null) {
		return <Spinner />;
	}
	if (!targets.length) {
		return (
			<p className="text-[0.875rem] text-panel-text-muted">
				{t("pages.xray.propagate.noCustomNodes")}
			</p>
		);
	}

	const allSelected =
		enabledIds.length > 0 && enabledIds.every((id) => selectedIds.includes(id));
	const someSelected = selectedIds.length > 0 && !allSelected;

	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked
				? [...selectedIds, id]
				: selectedIds.filter((selectedId) => selectedId !== id),
		);

	return (
		<div className="flex flex-col gap-3">
			<p className="text-[0.875rem] text-panel-text-muted">
				{t("pages.xray.propagate.hint")}
			</p>
			<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox disabled={!enabledIds.length} checked={allSelected || (someSelected ? "indeterminate" : false)} onCheckedChange={() => onChange(allSelected ? [] : enabledIds)} /><span>{t("pages.xray.propagate.selectAll")}</span></label>
			<div className="flex flex-col gap-2">
				{targets.map((target) => {
					const disabled = target.status !== "ok";
					return (
						<div key={target.id} className="flex flex-row items-center gap-2 justify-between">
							<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={selectedIds.includes(target.id)} onCheckedChange={(checked: boolean) => toggle(target.id, checked)} /><span>{target.name || target.id}</span></label>
							{disabled && (
								<Tooltip>
<TooltipTrigger asChild>
									<span className="text-panel-text-muted cursor-help">
										<CircleHelp className="w-[16px] h-[16px]" />
									</span>
								</TooltipTrigger>
<TooltipContent>{t(
										statusMessageKeys[
											target.status as keyof typeof statusMessageKeys
										],
									)}</TooltipContent>
</Tooltip>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};
