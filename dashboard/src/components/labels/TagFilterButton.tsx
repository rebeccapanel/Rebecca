import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Tags } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { LabelFilter, type LabelFilterValue } from "./LabelFilter";

type TagFilterButtonProps = {
	type: "host" | "inbound";
	value: LabelFilterValue;
	onChange: (value: LabelFilterValue) => void;
};

export const TagFilterButton: FC<TagFilterButtonProps> = ({
	type,
	value,
	onChange,
}) => {
	const { t } = useTranslation();
	return (
		<Popover>
			<PopoverTrigger asChild>
				<div className="relative shrink-0">
					<Button
						aria-label={t("tags.filterLabel")}
						variant="outline"
						className="size-9 rounded-full p-0"
					>
						<Tags className="size-4" />
					</Button>
					{value.tags.length > 0 && (
						<Badge className="pointer-events-none absolute -end-1 -top-1 rounded-full px-1.5 text-[0.6rem]">
							{value.tags.length}
						</Badge>
					)}
				</div>
			</PopoverTrigger>
			<PopoverContent align="end" collisionPadding={12} className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3">
				<LabelFilter
					type={type}
					value={value}
					onChange={onChange}
					showGroups={false}
				/>
			</PopoverContent>
		</Popover>
	);
};
