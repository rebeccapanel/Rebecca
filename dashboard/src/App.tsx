import "react-datepicker/dist/react-datepicker.css";
import { SeasonalOverlay } from "components/SeasonalOverlay";
import { SeasonalProvider } from "contexts/SeasonalContext";
import { useTranslation } from "react-i18next";
import { RouterProvider } from "react-router-dom";
import { Direction } from "radix-ui";
import { router } from "./pages/Router";

function App() {
	const { i18n } = useTranslation();
	return (
		<Direction.DirectionProvider dir={i18n.dir(i18n.language)}>
			<SeasonalProvider>
				<SeasonalOverlay />
				<RouterProvider router={router} useTransitions={false} />
			</SeasonalProvider>
		</Direction.DirectionProvider>
	);
}

export default App;
