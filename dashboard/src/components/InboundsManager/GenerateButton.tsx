import { Button } from "components/ui/button";
import { Sparkles } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";

export const GenerateButton: FC<{
	onClick: () => void;
	label?: string;
	loading?: boolean;
}> = ({ onClick, label, loading }) => {
	const { t } = useTranslation();
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="self-start"
			loading={loading}
			onClick={onClick}
		>
			<Sparkles data-icon="inline-start" />
			{label ?? t("generate.button")}
		</Button>
	);
};
