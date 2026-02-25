//@ts-ignore
import {langs} from "/translations/langs.js";
const langmap = new Map<string, string>();
for (const lang of Object.keys(langs) as string[]) {
	langmap.set(lang, langs[lang]);
}
console.log(langs);
type translation = {
	[key: string]: string | translation;
};
let res: () => unknown = () => {};
class I18n {
	static lang: string;
	static translations: translation[] = [];
	static done = new Promise<void>((res2, _reject) => {
		res = res2;
	});
	static async create(lang: string) {
		try {
			if (!(lang + ".json" in langs)) {
				if (lang.includes("-")) lang = lang.split("-")[0];
				if (!(lang + ".json" in langs)) {
					console.warn("Language " + lang + " not found, defaulting to en");
					lang = "en";
				}
			}

			const fetchWithTimeout = (url: string, ms = 5000) => {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), ms);
				return fetch(url, {signal: controller.signal}).finally(() => clearTimeout(timer));
			};

			const json = (await (await fetchWithTimeout("/translations/" + lang + ".json")).json()) as translation;
			const translations: translation[] = [];
			translations.push(json);
			if (lang !== "en") {
				translations.push((await (await fetchWithTimeout("/translations/en.json")).json()) as translation);
			}
			this.lang = lang;
			this.translations = translations;
		} catch (e) {
			console.error("[i18n] Failed to load translations, continuing with empty:", e);
		}
		res();
	}
	static translatePage() {
		const elms = document.querySelectorAll("[i18n]");
		for (const elm of Array.from(elms)) {
			const t = elm.getAttribute("i18n") as string;
			try {
				elm.textContent = this.getTranslation(t);
			} catch {
				console.error("Couldn't get " + t + "'s translation");
			}
		}
	}
	static getTranslation(msg: string, ...params: string[]): string {
		let str: string | undefined;
		const path = msg.split(".");
		for (const json of this.translations) {
			let jsont: string | translation = json;
			for (const thing of path) {
				if (typeof jsont !== "string" && jsont !== undefined) {
					jsont = jsont[thing];
				} else {
					jsont = json;
					break;
				}
			}

			if (typeof jsont === "string") {
				str = jsont;
				break;
			}
		}
		if (str) {
			return this.fillInBlanks(str, params);
		} else {
			throw new Error(msg + " not found");
		}
	}
	static fillInBlanks(msg: string, params: string[]): string {
		msg = msg.replace(/(\$\d+)|({{(.+?)}})/g, (_, dolar, str, match) => {
			if (dolar) {
				const number = Number(dolar.slice(1));
				if (params[number - 1] !== undefined) {
					return params[number - 1];
				} else {
					return dolar;
				}
			} else {
				const [op, strsSplit] = this.fillInBlanks(match, params).split(":");
				const [first, ...strs] = strsSplit.split("|");
				switch (op.toUpperCase()) {
					case "PLURAL": {
						const numb = Number(first);
						if (numb === 0) {
							return strs[strs.length - 1];
						}
						return strs[Math.min(strs.length - 1, numb - 1)];
					}
					case "GENDER": {
						if (first === "male") {
							return strs[0];
						} else if (first === "female") {
							return strs[1];
						} else if (first === "neutral") {
							if (strs[2]) {
								return strs[2];
							} else {
								return strs[0];
							}
						}
					}
				}
				return str;
			}
		});
		return msg;
	}
	static options() {
		return [...langmap.keys()].map((e) => e.replace(".json", ""));
	}
	static setLanguage(lang: string) {
		if (this.options().indexOf(lang) !== -1) {
			getPreferences().then(async (prefs) => {
				prefs.locale = lang;
				await I18n.create(lang);
				await setPreferences(prefs);
			});
		}
	}
}
console.log(langmap);
let userLocale = navigator.language.slice(0, 2) || "en";
if (I18n.options().indexOf(userLocale) === -1) {
	userLocale = "en";
}
const prefs = await getPreferences();
const storage = prefs.locale;
if (storage) {
	userLocale = storage;
} else {
	prefs.locale = userLocale;
	await setPreferences(prefs);
}
I18n.create(userLocale);
function makeWeirdProxy(obj: [string, translation | void] = ["", undefined]) {
	return new Proxy(obj, {
		get: (target, input) => {
			if (target[0] === "" && input in I18n) {
				//@ts-ignore
				return I18n[input];
			} else if (typeof input === "string") {
				let translations = obj[1];

				if (!translations) {
					//Really weird way to make sure I get english lol
					translations = I18n.translations[I18n.translations.length - 1];
					obj[1] = translations;
				}
				if (!translations) {
					return;
				}

				const value = translations[input];
				if (value) {
					let path = obj[0];
					if (path !== "") {
						path += ".";
					}
					path += input;
					if (typeof value === "string") {
						return (...args: string[]) => {
							return I18n.getTranslation(path, ...args);
						};
					} else {
						return makeWeirdProxy([path, value]);
					}
				}
			}
		},
	});
}
import jsonType from "./../../translations/en.json";
import {getPreferences, setPreferences} from "./utils/storage/userPreferences";
type beforeType = typeof jsonType;

type DoTheThing<T> = {
	[K in keyof T]: T[K] extends string ? (...args: string[]) => string : DoTheThing<T[K]>;
};

const proxyClass = makeWeirdProxy() as unknown as typeof I18n & DoTheThing<beforeType>;
export {proxyClass as I18n, langmap};
