import { Badge } from "components/ui/badge";
import { Alert } from "components/ui/alert";
import { CircleAlert } from "lucide-react";

import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useAPIRequestErrors } from "service/http";
import { requestErrorHref } from "utils/diagnostics";

export const RequestErrors = () => {
	const location = useLocation();
	const { errors } = useAPIRequestErrors();
	const { t } = useTranslation();
	if (!errors.length) return null;
	return (
		<div role="alert" aria-live="polite" className="flex flex-col gap-2 mb-4">
			{errors.map((item) => (
				<div key={item.key} className="relative">
					<Link to={
							item.href ||
							requestErrorHref(
								item.key,
								location.pathname.replace(/\/$/, "").endsWith("/xray-settings")
									? location.search
									: "",
							)
} aria-label={`${t("diagnostics.requestFailed")}: ${item.message}`} className="block no-underline"><Alert variant="destructive" className="rounded-[14px] items-start no-underline hover:no-underline min-[769px]:hover:shadow-md focus-visible:[outline:2px_solid] focus-visible:outline-panel-accent focus-visible:[outline-offset:2px]">
						<CircleAlert className="size-4" aria-hidden="true" />
						<div className="flex-1 min-w-0!">
							<div className="flex flex-row items-center gap-2 justify-between pe-8">
								<Badge className="bg-destructive/10 text-destructive">
									{t("diagnostics.level.error")}
								</Badge>
								<p className="font-semibold">
									{t("diagnostics.requestFailed")}
								</p>
							</div>
							<p dir="ltr" className="text-[0.75rem] font-mono">
								{item.key}
							</p>
							<p className="text-[0.875rem] whitespace-pre-wrap [word-break:break-word]">
								{item.message}
							</p>
						</div>
					</Alert></Link>
					
				</div>
			))}
		</div>
	);
};
