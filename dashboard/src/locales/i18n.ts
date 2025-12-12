import { joinPaths } from "@remix-run/router";

import fa from "date-fns/locale/fa-IR";
import ru from "date-fns/locale/ru";
import zh from "date-fns/locale/zh-CN";
import dayjs from "dayjs";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpApi from "i18next-http-backend";
import { registerLocale } from "react-datepicker";
import { initReactI18next } from "react-i18next";

declare module "i18next" {
	interface CustomTypeOptions {
		returnNull: false;
	}
}

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.use(HttpApi)
	.init(
		{
			debug: import.meta.env.NODE_ENV === "development",
			returnNull: false,
			fallbackLng: "en",
			interpolation: {
				escapeValue: false,
			},
			react: {
				useSuspense: false,
			},
			load: "languageOnly",
			detection: {
				caches: ["localStorage", "sessionStorage", "cookie"],
			},
			backend: {
				loadPath: joinPaths([
					import.meta.env.BASE_URL,
					`statics/locales/{{lng}}.json`,
				]),
			},
		},
		(err, _t) => {
			if (err) console.error("i18next initialization error:", err);
			else
				console.log(
					"i18next initialized successfully with language:",
					i18n.language,
				);
			dayjs.locale(i18n.language);
		},
	);

i18n.on("languageChanged", (lng) => {
	console.log("Language changed to:", lng);
	dayjs.locale(lng);

	// Set HTML lang and dir attributes for RTL support
	if (typeof document !== "undefined") {
		const htmlElement = document.documentElement;
		htmlElement.setAttribute("lang", lng);

		// Set direction for RTL languages
		if (lng === "fa") {
			htmlElement.setAttribute("dir", "rtl");
		} else {
			htmlElement.setAttribute("dir", "ltr");
		}
	}
});

// Set initial lang and dir attributes
if (typeof window !== "undefined") {
	const currentLang = i18n.language || "en";
	const htmlElement = document.documentElement;
	htmlElement.setAttribute("lang", currentLang);

	if (currentLang === "fa") {
		htmlElement.setAttribute("dir", "rtl");
	} else {
		htmlElement.setAttribute("dir", "ltr");
	}
}

// DataPicker
registerLocale("zh-cn", zh);
registerLocale("ru", ru);
registerLocale("fa", fa);

export default i18n;
