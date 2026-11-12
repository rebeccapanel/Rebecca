import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "components/ui/button";
import { DataSizeField } from "components/ui/data-size-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { Label } from "components/ui/label";

const GB_IN_BYTES = 1024 * 1024 * 1024;

export const TRAFFIC_PRESETS_GB = [100, 512, 1024, 2048, 5120] as const;

const PRESET_LABELS: Record<(typeof TRAFFIC_PRESETS_GB)[number], string> = {
	100: "100 GB",
	512: "512 GB",
	1024: "1 TB",
	2048: "2 TB",
	5120: "5 TB",
};

export type TrafficTarget = { kind: "user" | "admin"; name: string };

type AddTrafficDialogProps = {
	target: TrafficTarget | null;
	onClose: () => void;
	onApply: (deltaBytes: number) => Promise<void>;
};

export const AddTrafficDialog: FC<AddTrafficDialogProps> = ({ target, onClose, onApply }) => {
	const { t } = useTranslation();
	const [view, setView] = useState<"presets" | "custom">("presets");
	const [amountGb, setAmountGb] = useState("");
	const [busy, setBusy] = useState(false);
	const description = target ? t(target.kind === "user" ? "addTraffic.toUser" : "addTraffic.toAdmin", { name: target.name }) : "";

	const finish = () => {
		setView("presets");
		setAmountGb("");
		onClose();
	};

	const apply = async (deltaBytes: number) => {
		if (!(deltaBytes > 0) || busy) return;
		setBusy(true);
		try {
			await onApply(deltaBytes);
			finish();
		} catch (_error) {
			return;
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open && !busy) finish();
			}}
		>
			<DialogContent className="flex flex-col gap-4 p-5 sm:max-w-sm">
				<DialogHeader className="text-start">
					<DialogTitle>{t("services.userActions.traffic.add")}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{view === "presets" ? (
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{TRAFFIC_PRESETS_GB.map((gb) => (
							<button
								key={gb}
								type="button"
								disabled={busy}
								onClick={() => void apply(gb * GB_IN_BYTES)}
								className={buttonVariants({ variant: "outline" })}
							>
								{PRESET_LABELS[gb]}
							</button>
						))}
						<button
							type="button"
							disabled={busy}
							onClick={() => setView("custom")}
							className={buttonVariants({ variant: "outline" })}
						>
							{t("addTraffic.custom")}
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<Label htmlFor="add-traffic-amount">{t("addTraffic.amount")}</Label>
						<DataSizeField id="add-traffic-amount" valueGb={amountGb} onChangeGb={setAmountGb} disabled={busy} />
						<DialogFooter className="flex-row items-center justify-between gap-2 pt-2">
							<button
								type="button"
								disabled={busy}
								onClick={() => setView("presets")}
								className={buttonVariants({ variant: "ghost", size: "sm" })}
							>
								{t("addTraffic.back")}
							</button>
							<button
								type="button"
								disabled={busy || !(Number(amountGb) > 0)}
								onClick={() => void apply(Math.round(Number(amountGb) * GB_IN_BYTES))}
								className={buttonVariants({ size: "sm" })}
							>
								{t("add")}
							</button>
						</DialogFooter>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};
