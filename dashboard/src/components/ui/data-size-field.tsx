import { type FC, useEffect, useState } from "react";
import { NumberField } from "components/ui/number-field";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "components/ui/select";

export type SizeUnit = "MB" | "GB" | "TB";

const UNITS: SizeUnit[] = ["MB", "GB", "TB"];
const GB_PER_UNIT: Record<SizeUnit, number> = { MB: 1 / 1024, GB: 1, TB: 1024 };

const toDisplay = (gb: number, unit: SizeUnit) => String(Math.round((gb / GB_PER_UNIT[unit]) * 100) / 100);
const toGb = (amount: number, unit: SizeUnit) => String(Math.round(amount * GB_PER_UNIT[unit] * 1e9) / 1e9);
const unitForValue = (gb: number): SizeUnit => (gb >= 1024 ? "TB" : gb > 0 && gb < 1 ? "MB" : "GB");

type DataSizeFieldProps = {
	id?: string;
	valueGb: string;
	onChangeGb: (next: string) => void;
	disabled?: boolean;
	invalid?: boolean;
	placeholder?: string;
};

export const DataSizeField: FC<DataSizeFieldProps> = ({ id, valueGb, onChangeGb, disabled = false, invalid = false, placeholder }) => {
	const hasValue = valueGb.trim() !== "";
	const [unit, setUnit] = useState<SizeUnit>(() => (hasValue ? unitForValue(Number(valueGb)) : "GB"));
	const [draft, setDraft] = useState(() => (hasValue ? toDisplay(Number(valueGb), unit) : ""));

	useEffect(() => {
		if (!hasValue) {
			if (draft !== "") setDraft("");
			return;
		}
		const parsed = Number.parseFloat(draft);
		if (Number.isFinite(parsed) && Math.abs(parsed * GB_PER_UNIT[unit] - Number(valueGb)) < 1e-6) return;
		setDraft(toDisplay(Number(valueGb), unit));
	}, [valueGb, unit, draft, hasValue]);

	const handleInput = (raw: string) => {
		setDraft(raw);
		if (raw.trim() === "") {
			onChangeGb("");
			return;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return;
		onChangeGb(toGb(parsed, unit));
	};

	const changeUnit = (next: SizeUnit) => {
		if (next === unit) return;
		const shown = Number.parseFloat(draft);
		setUnit(next);
		if (!hasValue) return;
		const movesUp = GB_PER_UNIT[next] > GB_PER_UNIT[unit];
		const shownInNext = (shown * GB_PER_UNIT[unit]) / GB_PER_UNIT[next];
		if (movesUp && Number.isFinite(shown) && Math.round(shownInNext * 100) === 0) {
			onChangeGb(toGb(shown, next));
			return;
		}
		setDraft(toDisplay(Number(valueGb), next));
	};

	const unitControl = (
		<Select value={unit} onValueChange={(next) => changeUnit(next as SizeUnit)} disabled={disabled}>
			<SelectTrigger className="h-full w-auto gap-1 rounded-none border-0 border-s border-input bg-muted ps-2 pe-1.5 text-xs shadow-none focus-visible:ring-0">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{UNITS.map((item) => (
					<SelectItem key={item} value={item}>
						<SelectItemText>{item}</SelectItemText>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	return (
		<NumberField
			id={id}
			value={draft}
			placeholder={placeholder}
			onChange={handleInput}
			step={1}
			min={0}
			unitSlot={unitControl}
			disabled={disabled}
			invalid={invalid}
		/>
	);
};
