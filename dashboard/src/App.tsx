import "react-datepicker/dist/react-datepicker.css";
import { SeasonalOverlay } from "components/SeasonalOverlay";
import { SeasonalProvider } from "contexts/SeasonalContext";
import { useAppleEmoji } from "hooks/useAppleEmoji";
import { RouterProvider } from "react-router-dom";
import { router } from "./pages/Router";

function App() {
	useAppleEmoji();

	return (
		<SeasonalProvider>
			<SeasonalOverlay />
			<RouterProvider router={router} />
		</SeasonalProvider>
	);
}

export default App;
