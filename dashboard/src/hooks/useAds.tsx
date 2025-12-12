import { useQuery } from "react-query";

import { fetch } from "service/http";
import type { AdsResponse } from "types/Ads";

const fetchAds = () => fetch<AdsResponse>("/ads");

const useAds = (enabled = true) => {
	return useQuery<AdsResponse, Error>({
		queryKey: ["ads"],
		queryFn: fetchAds,
		enabled,
		staleTime: 1000 * 60 * 30,
		cacheTime: 1000 * 60 * 60,
	});
};

export default useAds;
