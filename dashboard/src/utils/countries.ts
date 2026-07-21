import type { MultiValueAutocompleteOption } from "../components/common/MultiValueAutocomplete";

export const countryCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`
	.split(/\s+/)
	.filter(Boolean);

export const countryFlag = (code: string) =>
	String.fromCodePoint(
		...code
			.toUpperCase()
			.slice(0, 2)
			.split("")
			.map((letter) => 127397 + letter.charCodeAt(0)),
	);

export const countryName = (code: string, locale = "en") => {
	try {
		return (
			new Intl.DisplayNames([locale, "en"], { type: "region" }).of(
				code.toUpperCase(),
			) ?? code.toUpperCase()
		);
	} catch {
		return code.toUpperCase();
	}
};

export const countrySelectOptions = (
	locale = "en",
	codes: string[] = countryCodes,
): MultiValueAutocompleteOption[] =>
	codes.map((code) => {
		const normalizedCode = code.toLowerCase();
		const name = countryName(code, locale);
		return {
			label: `${countryFlag(code)} ${normalizedCode} - ${name}`,
			searchLabel: `${normalizedCode} ${name}`,
			title: name,
			value: normalizedCode,
		};
	});

const normalizedCountryName = (value: string) =>
	value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

const windscribeCountryAliases: Record<string, string> = {
	bosnia: "ba",
	"bosnia and herzegovina": "ba",
	bolivia: "bo",
	brunei: "bn",
	"czech republic": "cz",
	iran: "ir",
	macedonia: "mk",
	moldova: "md",
	"north macedonia": "mk",
	russia: "ru",
	"south korea": "kr",
	taiwan: "tw",
	tanzania: "tz",
	"the bahamas": "bs",
	turkey: "tr",
	uae: "ae",
	uk: "gb",
	"united arab emirates": "ae",
	us: "us",
	"united states": "us",
	venezuela: "ve",
	vietnam: "vn",
};

export const countryCodeFromEnglishName = (name: string) => {
	const normalized = normalizedCountryName(name);
	if (windscribeCountryAliases[normalized]) {
		return windscribeCountryAliases[normalized];
	}
	const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
	return countryCodes
		.find(
			(code) =>
				normalizedCountryName(displayNames.of(code) ?? "") === normalized,
		)
		?.toLowerCase();
};
