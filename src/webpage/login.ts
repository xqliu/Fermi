import {adduser, Specialuser} from "./utils/utils.js";
import {I18n} from "./i18n.js";

const API = "https://chat.llbrother.org/api";
const INSTANCE_INFO = {
	value: "chat.llbrother.org",
	wellknown: "https://chat.llbrother.org",
	api: API,
	cdn: "https://chat.llbrother.org",
	gateway: "wss://chat.llbrother.org/api",
};

// Auto-redirect to app if already logged in
if (window.location.pathname === "/login" || window.location.pathname === "/login/") {
	try {
		const info = JSON.parse(localStorage.getItem("userinfos") || "{}");
		if (info.currentuser && info.users && Object.keys(info.users).length > 0) {
			window.location.pathname = "/app";
		}
	} catch {}
}

export async function makeLogin(
	_trasparentBg = false,
	_instance = "",
	handle?: (user: Specialuser) => void,
) {
	localStorage.setItem("instanceinfo", JSON.stringify(INSTANCE_INFO));

	// Build a simple login form with plain HTML elements
	const overlay = document.createElement("div");
	overlay.style.cssText = `
		position: fixed; top: 0; left: 0; width: 100%; height: 100%;
		background: var(--secondary-bg, #2f3136);
		z-index: 200; display: flex; align-items: center; justify-content: center;
	`;

	const box = document.createElement("div");
	box.style.cssText = `
		background: var(--primary-bg, #36393f); border-radius: 8px; padding: 32px;
		width: 90%; max-width: 400px; color: var(--primary-text-color, #fff);
	`;

	const title = document.createElement("h2");
	title.textContent = "登录";
	title.style.cssText = "margin: 0 0 24px 0; text-align: center;";

	const emailInput = document.createElement("input");
	emailInput.type = "text";
	emailInput.placeholder = "邮箱";
	emailInput.autocomplete = "email";
	emailInput.style.cssText = `
		width: 100%; padding: 12px; margin-bottom: 16px; border: none;
		border-radius: 4px; background: var(--secondary-bg, #2f3136);
		color: var(--primary-text-color, #fff); font-size: 16px;
		box-sizing: border-box; -webkit-appearance: none;
	`;

	const pwInput = document.createElement("input");
	pwInput.type = "password";
	pwInput.placeholder = "密码";
	pwInput.autocomplete = "current-password";
	pwInput.style.cssText = emailInput.style.cssText;

	const errorDiv = document.createElement("div");
	errorDiv.style.cssText = "color: #f04747; font-size: 14px; margin-bottom: 12px; display: none;";

	const btn = document.createElement("button");
	btn.textContent = "登录";
	btn.style.cssText = `
		width: 100%; padding: 12px; border: none; border-radius: 4px;
		background: #5865f2; color: #fff; font-size: 16px; cursor: pointer;
	`;

	const doLogin = async () => {
		const email = emailInput.value.trim();
		const pw = pwInput.value;
		if (!email || !pw) return;

		btn.disabled = true;
		btn.textContent = "登录中...";
		errorDiv.style.display = "none";

		try {
			const res = await fetch(API + "/auth/login", {
				method: "POST",
				headers: {"Content-type": "application/json; charset=UTF-8"},
				body: JSON.stringify({login: email, password: pw}),
			});
			const json = await res.json();

			if (json.token) {
				const u = adduser({
					serverurls: INSTANCE_INFO,
					email,
					token: json.token,
				});
				u.username = email;

				if (handle) {
					overlay.remove();
					handle(u);
					return;
				}
				const redir = new URLSearchParams(window.location.search).get("goback");
				if (redir && (!URL.canParse(redir) || new URL(redir).host === window.location.host)) {
					window.location.replace(redir);
				} else {
					window.location.replace("/channels/@me");
				}
			} else {
				const msg = json.errors?.[0]?._errors?.[0]?.message || json.message || "登录失败";
				errorDiv.textContent = msg;
				errorDiv.style.display = "block";
			}
		} catch (e) {
			errorDiv.textContent = "网络错误，请重试";
			errorDiv.style.display = "block";
		} finally {
			btn.disabled = false;
			btn.textContent = "登录";
		}
	};

	btn.onclick = doLogin;
	// Enter key to submit
	const onEnter = (e: KeyboardEvent) => { if (e.key === "Enter") doLogin(); };
	emailInput.onkeydown = onEnter;
	pwInput.onkeydown = onEnter;

	box.append(title, emailInput, pwInput, errorDiv, btn);
	overlay.append(box);
	document.body.append(overlay);

	// Focus email input
	requestAnimationFrame(() => emailInput.focus());
}

await I18n.done;
if (window.location.pathname.startsWith("/login")) {
	makeLogin();
}
