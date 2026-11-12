import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Button } from "components/ui/button";
import { Checkbox } from "components/ui/checkbox";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { SlidersHorizontal } from "lucide-react";

import { useTranslation } from "react-i18next";
import type { DataTableColumn } from "./DataTable.types";

type DataTableColumnMenuProps<TData> = {
	columns: DataTableColumn<TData>[];
	visibility: Record<string, boolean>;
	onChange: (next: Record<string, boolean>) => void;
};

/**
 * Column chooser for the dashboard tables. Mirrors the "Columns" control of the
 * rebuilt dashboard, but keeps the panel's own menu styling so the table still
 * looks like the rest of the panel.
 */
export function DataTableColumnMenu<TData>({
	columns,
	visibility,
	onChange,
}: DataTableColumnMenuProps<TData>) {
	const { t } = useTranslation();
	// Structural columns (selection, actions) are not offered: hiding them would
	// leave the row without its controls.
	const choosable = columns.filter(
		(column) => !column.id.startsWith("__") && column.menuLabel !== undefined,
	);

	if (choosable.length === 0) return null;

	const visibleCount = choosable.filter(
		(column) => visibility[column.id] !== false,
	).length;

	return (
		<DropdownMenu>
			<Tooltip>
<TooltipTrigger asChild>
				<DropdownMenuTrigger asChild>
					<Button aria-label={t("next.table.toggleColumns")} size="sm" variant="outline" className="h-9 w-9 rounded-full">
						<SlidersHorizontal className="w-[16px]" />
					</Button>
				</DropdownMenuTrigger>
			</TooltipTrigger>
<TooltipContent>{t("next.table.toggleColumns")}</TooltipContent>
</Tooltip>
			
				<DropdownMenuContent className="z-[1800] min-w-[220px]! bg-panel-surface border-panel-border!">
					<div className="flex flex-col gap-2 px-3 py-2">
						<p className="text-[0.75rem] text-panel-text-muted uppercase tracking-[0.08em]">
							{t("next.table.toggleColumns")} · {visibleCount}/{choosable.length}
						</p>
						{choosable.map((column) => {
							const id = `column-${column.id}`;
							const checked = visibility[column.id] !== false;
							return (
								<label key={column.id} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox id={id} checked={checked} onCheckedChange={(checked: boolean) => onChange({
											...visibility,
											[column.id]: checked,
										})} /><span><span className="text-[0.875rem]">
										{column.menuLabel}
									</span></span></label>
							);
						})}
					</div>
				</DropdownMenuContent>
			
		</DropdownMenu>
	);
}
