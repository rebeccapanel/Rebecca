import { useSeasonal } from "contexts/SeasonalContext";
import type { FC } from "react";

export const SeasonalOverlay: FC = () => {
	const { isChristmas, shouldSnow } = useSeasonal();

	if (!isChristmas) return null;

	return <>{shouldSnow && <div className="rb-snow-layer" aria-hidden />}</>;
};
