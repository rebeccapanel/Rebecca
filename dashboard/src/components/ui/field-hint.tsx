import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";

export const FieldHint = ({ children }: { children: ReactNode }) => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={t("fieldHint.moreInfo")}
					className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={(event) => {
						event.preventDefault();
						setOpen(true);
					}}
					onPointerEnter={(event) => {
						if (event.pointerType === "mouse") setOpen(true);
					}}
					onPointerLeave={(event) => {
						if (event.pointerType === "mouse") setOpen(false);
					}}
				>
					<Info className="size-3.5" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				onOpenAutoFocus={(event) => event.preventDefault()}
				className="w-auto max-w-64 px-3 py-2 text-xs leading-5 text-muted-foreground"
			>
				{children}
			</PopoverContent>
		</Popover>
	);
};
