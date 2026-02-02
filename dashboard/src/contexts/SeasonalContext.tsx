import {
	createContext,
	type FC,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	getChristmasWindow,
	isChristmasSeason,
	type SeasonWindow,
} from "utils/seasonal";

type SeasonalState = {
	isChristmas: boolean;
	window: SeasonWindow;
	shouldSnow: boolean;
	snowEnabled: boolean;
	toggleSnow: () => void;
};

const defaultWindow = getChristmasWindow();
const SeasonalContext = createContext<SeasonalState>({
	isChristmas: false,
	window: defaultWindow,
	shouldSnow: false,
	snowEnabled: true,
	toggleSnow: () => {},
});

export const SeasonalProvider: FC<{ children: ReactNode }> = ({ children }) => {
	const [now, setNow] = useState(() => new Date());
	const [snowEnabled, setSnowEnabled] = useState<boolean>(() => {
		try {
			const stored = localStorage.getItem("rb-snow-enabled");
			return stored === null ? true : stored === "true";
		} catch {
			return true;
		}
	});

	// Refresh once an hour so the automatic window can open/close without reload
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60 * 60 * 1000);
		return () => clearInterval(timer);
	}, []);

	const window = useMemo(() => getChristmasWindow(now), [now]);
	const isChristmas = useMemo(
		() => isChristmasSeason(now, window),
		[now, window],
	);
	const shouldSnow = isChristmas && snowEnabled;

	useEffect(() => {
		try {
			localStorage.setItem("rb-snow-enabled", String(snowEnabled));
		} catch {}
	}, [snowEnabled]);

	// Toggle the holiday theme class on the root element
	useEffect(() => {
		const root = document.documentElement;
		if (isChristmas) {
			root.classList.add("rb-seasonal-christmas");
		} else {
			root.classList.remove("rb-seasonal-christmas");
		}
		return () => root.classList.remove("rb-seasonal-christmas");
	}, [isChristmas]);

	return (
		<SeasonalContext.Provider
			value={{
				isChristmas,
				window,
				shouldSnow,
				snowEnabled,
				toggleSnow: () => setSnowEnabled((prev) => !prev),
			}}
		>
			{children}
		</SeasonalContext.Provider>
	);
};

export const useSeasonal = () => useContext(SeasonalContext);
