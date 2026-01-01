import "react-datepicker/dist/react-datepicker.css";
import "react-loading-skeleton/dist/skeleton.css";
import { RouterProvider } from "react-router-dom";
import { SeasonalOverlay } from "components/SeasonalOverlay";
import { SeasonalProvider } from "contexts/SeasonalContext";
import { router } from "./pages/Router";

function App() {
	return (
		<SeasonalProvider>
			<SeasonalOverlay />
			<RouterProvider router={router} />
		</SeasonalProvider>
	);
}

export default App;
