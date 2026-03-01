// @ts-ignore — __BUILD_VERSION__ replaced at build time
export const FERMI_VERSION: string = "__BUILD_VERSION__";
// @ts-ignore — signal to inline debug that module loaded
window.__moduleLoaded = true;
// @ts-ignore
if (window.__loadingDebug) window.__loadingDebug("index.js 已加载, v=" + FERMI_VERSION);

// Startup version check: detect stale cache (especially iOS Safari PWA where
// SW updates and fetch cache-busting are unreliable).
// Uses XMLHttpRequest to bypass Service Worker fetch handler entirely.
(function startupVersionCheck() {
	try {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", "/getupdates?_v=" + Date.now() + Math.random(), true);
		xhr.setRequestHeader("Cache-Control", "no-cache, no-store");
		xhr.setRequestHeader("Pragma", "no-cache");
		xhr.onload = function() {
			if (xhr.status === 200) {
				const serverVersion = xhr.responseText.trim();
				if (serverVersion && serverVersion !== FERMI_VERSION) {
					console.log(`[startup] Version mismatch: running ${FERMI_VERSION}, server ${serverVersion}. Redirecting to /reset`);
					window.location.href = "/reset";
				}
			}
		};
		xhr.send();
	} catch (_) {}
})();

// When a new SW activates and finishes re-caching, it sends "newVersion"
// Reload to pick up all new files
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data?.code === "newVersion" && event.data.version !== FERMI_VERSION) {
			console.log(`[update] New version ${event.data.version}, current ${FERMI_VERSION}, reloading`);
			window.location.reload();
		}
	});
}

import {Localuser} from "./localuser.js";
import {Contextmenu} from "./contextmenu.js";
import {mobile, Specialuser} from "./utils/utils.js";
import {setTheme} from "./utils/utils.js";
import {MarkDown} from "./markdown.js";
import {Message} from "./message.js";
import {File} from "./file.js";
import {I18n} from "./i18n.js";
import "./utils/pollyfills.js";
import {makeLogin} from "./login.js";
import {Hover} from "./hover.js";
import "./templatePage.js";
import "./more.js";
import "./recover.js";
import "./home.js";
import "./invite.js";
import "./oauth2/auth.js";
import "./audio/page.js";
import "./404.js";

if (window.location.pathname === "/app" || window.location.pathname === "/") {
	// Instead of navigating (which can silently fail in iOS PWA standalone),
	// rewrite the URL in-place and fall through to the /channels handler.
	try {
		const info = JSON.parse(localStorage.getItem("userinfos") || "{}");
		if (info.currentuser && info.users && Object.keys(info.users).length > 0) {
			history.replaceState(null, "", "/channels/@me");
		} else {
			// Login requires a real page load (different HTML)
			window.location.replace("/login");
		}
	} catch {
		window.location.replace("/login");
	}
}
export interface CustomHTMLDivElement extends HTMLDivElement {
	markdown: MarkDown;
}
if (window.location.pathname.startsWith("/channels")) {
	// Push a guard entry so swipe-back can never leave the app
	// (catches any leftover login/app entries in history)
	if (!history.state) {
		history.replaceState({guard: true}, "", window.location.href);
	}

	let templateID = new URLSearchParams(window.location.search).get("templateID");
	const _loaddesc = document.getElementById("load-desc") as HTMLSpanElement;
	const _debugEl = document.getElementById("loading-debug") as HTMLElement | null;
	const _debugLog = (msg: string) => {
		// @ts-ignore
		if (window.__loadingDebug) window.__loadingDebug(msg);
		else if (_debugEl) _debugEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
		console.log(`[startup] ${msg}`);
	};
	// Global loading timeout — if stuck for 15s, make debug info prominent
	setTimeout(() => {
		const loading = document.getElementById("loading");
		if (loading && !loading.classList.contains("doneloading") && _debugEl) {
			_debugEl.style.color = "#f04747";
			_debugEl.style.fontSize = "12px";
			_debugEl.textContent += " ⚠️ 加载超时";
		}
	}, 15000);
	_debugLog("加载语言包...");
	if (_loaddesc) _loaddesc.textContent = "正在加载语言包...";
	await I18n.done;
	_debugLog("语言包完成，初始化...");
	if (_loaddesc) _loaddesc.textContent = "正在初始化...";
	Localuser.loadFont();

	I18n.translatePage();

	const userInfoElement = document.getElementById("userinfo") as HTMLDivElement;
	userInfoElement.addEventListener("click", (event) => {
		event.stopImmediatePropagation();
		const rect = userInfoElement.getBoundingClientRect();
		Localuser.userMenu.makemenu(rect.x, rect.top - 10 - window.innerHeight, thisUser);
	});

	const switchAccountsElement = document.getElementById("switchaccounts") as HTMLDivElement;
	switchAccountsElement.addEventListener("click", async (event) => {
		event.stopImmediatePropagation();
		Localuser.showAccountSwitcher(thisUser);
	});

	let thisUser: Localuser;
	function regSwap(l: Localuser) {
		l.onswap = (l) => {
			thisUser = l;
			regSwap(l);
		};
		l.fileExtange = (img, html) => {
			const blobArr: Blob[] = [];
			const htmlArr = imagesHtml;
			let i = 0;
			for (const file of images) {
				const img = imagesHtml.get(file);
				if (!img) continue;
				if (pasteImageElement.contains(img)) {
					pasteImageElement.removeChild(img);
					blobArr.push(images[i]);
				} else {
					i++;
				}
			}
			images = img;
			imagesHtml = html;
			for (const file of images) {
				const img = imagesHtml.get(file);
				if (!img) throw new Error("Image without HTML, exiting");
				pasteImageElement.append(img);
			}
			return [blobArr, htmlArr];
		};
	}
	const loaddesc = document.getElementById("load-desc") as HTMLSpanElement;
	try {
		const current = sessionStorage.getItem("currentuser") || Localuser.users.currentuser;
		_debugLog(`user: ${current ? "found" : "none"}`);
		if (!Localuser.users.users[current]) {
			// Hide loading screen so login dialog is visible
			const loading = document.getElementById("loading") as HTMLDivElement;
			loading.classList.add("doneloading");
			loading.classList.remove("loading");
			thisUser = new Localuser(await new Promise<Specialuser>((res) => makeLogin(true, "", res)));
			// Re-show loading screen for WS connection phase
			loading.classList.remove("doneloading");
			loading.classList.add("loading");
			loaddesc.textContent = "正在连接服务器...";
		} else {
			thisUser = new Localuser(Localuser.users.users[current]);
		}

		regSwap(thisUser);
		loaddesc.textContent = "正在连接服务器...";
		const finishLoading = async () => {
			loaddesc.textContent = "正在加载频道...";
			thisUser.loaduser();
			await thisUser.init();
			const loading = document.getElementById("loading") as HTMLDivElement;
			loading.classList.add("doneloading");
			loading.classList.remove("loading");
			loaddesc.textContent = I18n.loaded();
			console.log("done loading");
			if (templateID) {
				thisUser.passTemplateID(templateID);
			}
			thisUser.subscribePush().catch((e: any) => console.warn("[push] subscribe failed:", e));
		};
		let retryCount = 0;
		const connectWithRetry = async () => {
			try {
				_debugLog(`WS 连接中... (attempt ${retryCount + 1})`);
				loaddesc.textContent = "正在连接服务器...";
				// Timeout WS connection — iOS PWA can hang indefinitely
				await Promise.race([
					thisUser.initwebsocket(),
					new Promise((_, rej) => setTimeout(() => rej(new Error("WS timeout 15s")), 15000)),
				]);
				retryCount = 0;
				await finishLoading();
			} catch (e) {
				retryCount++;
				if (retryCount > 5) {
					// Mimic kill+reopen: clear session state and do a full reload
					console.error("[init] 5 retries failed, clearing session and reloading");
					sessionStorage.clear();
					window.location.reload();
					return;
				}
				const delay = Math.min(3000 * retryCount, 10000);
				_debugLog(`WS 失败 #${retryCount}: ${e instanceof Error ? e.message : e}`);
				console.error(`[init] WS failed (attempt ${retryCount}/5), error: ${e instanceof Error ? e.message : e}, retrying in ${delay/1000}s...`);
				loaddesc.textContent = `连接失败，正在重试... (${retryCount}/5)`;
				await new Promise((r) => setTimeout(r, delay));
				await connectWithRetry();
			}
		};
		connectWithRetry();
	} catch (e) {
		_debugLog(`启动异常: ${e instanceof Error ? e.message : e}`);
		console.error(e);
		loaddesc.textContent = I18n.accountNotStart();
		thisUser = new Localuser(-1);
	}
	//TODO move this to the channel/guild class, this is a weird spot
	const menu = new Contextmenu<void, void>("create rightclick");
	menu.addButton(
		I18n.channel.createChannel(),
		() => {
			if (thisUser.lookingguild) {
				thisUser.lookingguild.createchannels();
			}
		},
		{visible: () => thisUser.isAdmin()},
	);

	menu.addButton(
		I18n.channel.createCatagory(),
		() => {
			if (thisUser.lookingguild) {
				thisUser.lookingguild.createcategory();
			}
		},
		{visible: () => thisUser.isAdmin()},
	);
	const channelw = document.getElementById("channelw");
	console.log(channelw);

	// Jump-to-bottom button — sits inside quick-bubbles, aligned with recent channel bubbles
	{
		const bubblesContainer = document.getElementById("quick-bubbles");
		const scrollWrap = document.getElementById("scrollWrap") as HTMLDivElement | null;
		if (bubblesContainer && scrollWrap) {
			const jumpBtn = document.createElement("div");
			jumpBtn.classList.add("quick-bubble", "jump-to-bottom");

			jumpBtn.hidden = true;
			const iconWrap = document.createElement("div");
			iconWrap.classList.add("quick-bubble-icon-wrap");
			const arrow = document.createElement("div");
			arrow.classList.add("jump-to-bottom-arrow");
			iconWrap.appendChild(arrow);
			jumpBtn.appendChild(iconWrap);
			bubblesContainer.appendChild(jumpBtn);

			// Track current scroller to avoid duplicate listeners
			let currentScroller: HTMLDivElement | null = null;
			const bindScroller = () => {
				const scroller = scrollWrap.querySelector(".scroller") as HTMLDivElement | null;
				if (!scroller || scroller === currentScroller) return;
				currentScroller = scroller;
				// Hide on channel switch — only show after scroll settles
				jumpBtn.hidden = true;
				let scrollTimer: ReturnType<typeof setTimeout> | null = null;
				scroller.addEventListener("scroll", () => {
					// Debounce: wait 200ms after last scroll event to check position
					if (scrollTimer) clearTimeout(scrollTimer);
					scrollTimer = setTimeout(() => {
						const distFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
						jumpBtn.hidden = distFromBottom < 300;
					}, 200);
				});
			};
			// Observe for scroller appearing (channel switch replaces .scroller)
			new MutationObserver(bindScroller).observe(scrollWrap, {childList: true, subtree: true});
			// Also check now in case scroller already exists
			bindScroller();
			// Re-check periodically as fallback (scroller can appear without mutation)
			setInterval(bindScroller, 2000);

			jumpBtn.onclick = () => {
				thisUser.channelfocus?.goToBottom();
				jumpBtn.hidden = true;
			};
		}
	}

	if (channelw)
		channelw.addEventListener("keypress", (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey || e.metaKey) return;
			let owner = e.target as HTMLElement;
			while (owner !== channelw) {
				if (owner.tagName === "input" || owner.contentEditable !== "false") {
					return;
				}
				owner = owner.parentElement as HTMLElement;
			}
			typebox.markdown.boxupdate(Infinity);
		});
	menu.bindContextmenu(document.getElementById("channels") as HTMLDivElement);

	const pasteImageElement = document.getElementById("pasteimage") as HTMLDivElement;
	let replyingTo: Message | null = null;
	window.addEventListener("popstate", (e) => {
		if (e.state instanceof Object && !("guard" in e.state)) {
			thisUser.goToState(e.state);
		} else {
			// Any back navigation to a non-app state (login, guard, null):
			// show sidebar on mobile, and always re-push to prevent leaving the app
			if (mobile) {
				const toggle = document.getElementById("maintoggle") as HTMLInputElement;
				if (toggle && !toggle.checked) toggle.checked = true;
			}
			history.pushState(null, "", window.location.href);
		}
	});
	let nonceMap = new Map<string, string>();
	//@ts-expect-error unused right now, not needed
	function getNonce(id: string) {
		const nonce = nonceMap.get(id) || Math.floor(Math.random() * 1000000000) + "";
		nonceMap.set(id, nonce);
		return nonce;
	}
	async function handleEnter(event: KeyboardEvent): Promise<void> {
		if (event.isComposing || markdown.composing) return;
		if (event.key === "Escape" && (images.length || thisUser.channelfocus?.replyingto)) {
			while (images.length) {
				const elm = imagesHtml.get(images.pop() as Blob) as HTMLElement;
				if (pasteImageElement.contains(elm)) pasteImageElement.removeChild(elm);
			}
			if (thisUser.channelfocus) {
				thisUser.channelfocus?.replyingto?.div?.classList.remove("replying");
				thisUser.channelfocus.replyingto = null;
				thisUser.channelfocus.makereplybox();
			}
			return;
		}
		if (thisUser.handleKeyUp(event)) {
			return;
		}

		const channel = thisUser.channelfocus;
		if (!channel) return;
		const content = MarkDown.gatherBoxText(typebox);
		if (content === "" && event.key === "ArrowUp") {
			channel.editLast();
			return;
		}
		channel.typingstart();

		if (event.key === "Enter" && !event.shiftKey) {
			if (!channel.canMessageRightNow()) return;
			if (channel.curCommand) {
				channel.submitCommand();
				return;
			}
			event.preventDefault();
			replyingTo = thisUser.channelfocus ? thisUser.channelfocus.replyingto : null;
			if (replyingTo?.div) {
				replyingTo.div.classList.remove("replying");
			}
			if (thisUser.channelfocus) {
				thisUser.channelfocus.replyingto = null;
				thisUser.channelfocus.makereplybox();
			}
			const attachments = images.filter((_) => document.contains(imagesHtml.get(_) || null));
			while (images.length) {
				const elm = imagesHtml.get(images.pop() as Blob) as HTMLElement;
				if (pasteImageElement.contains(elm)) pasteImageElement.removeChild(elm);
			}
			typebox.innerHTML = "";
			typebox.markdown.txt = [];
			sessionStorage.removeItem(`draft:${channel.id}`);
			try {
				await new Promise<void>((mres, rej) =>
					channel.sendMessage(
						content,
						{
							attachments,
							embeds: [], // Add an empty array for the embeds property
							replyingto: replyingTo,
							sticker_ids: [],
							//nonce: getNonce(channel.id),
						},
						(res) => {
							if (res === "Ok") {
								mres();
							} else {
								rej();
							}
						},
					),
				);
			} catch {
				images = attachments;
				for (const file of images) {
					const img = imagesHtml.get(file);
					if (!img) continue;
					pasteImageElement.append(img);
				}
				channel.replyingto = replyingTo;
				channel.makereplybox();
				typebox.textContent = content;
				typebox.markdown.txt = content.split("");
				typebox.markdown.boxupdate(Infinity);
			}
			nonceMap.delete(channel.id);
		}
	}

	const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
	const markdown = new MarkDown("", thisUser);
	typebox.markdown = markdown;
	typebox.addEventListener("keyup", handleEnter);
	typebox.addEventListener("keydown", (event) => {
		if (event.isComposing || markdown.composing) return;
		thisUser.keydown(event);
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	});
	// iOS/iPadOS: Return key may not fire key="Enter" on keydown/keyup reliably.
	// Handle both insertParagraph and insertLineBreak from virtual keyboards.
	typebox.addEventListener("beforeinput", (event) => {
		if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
			event.preventDefault();
			// Force composing off — user confirmed input
			markdown.composing = false;
			// Trigger send directly
			handleEnter(new KeyboardEvent("keyup", {key: "Enter", shiftKey: false}));
		}
	});
	markdown.giveBox(typebox);
	{
		const searchBox = document.getElementById("searchBox") as CustomHTMLDivElement;
		const markdown = new MarkDown("", thisUser);
		searchBox.markdown = markdown;
		const searchX = document.getElementById("searchX") as HTMLElement;
		searchBox.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				thisUser.mSearch(markdown.rawString);
			}
		});
		searchBox.addEventListener("keyup", () => {
			if (searchBox.textContent === "") {
				setTimeout(() => (searchBox.innerHTML = ""), 0);
				searchX.classList.add("svg-search");
				searchX.classList.remove("svg-plainx");
				searchBox.parentElement!.classList.remove("searching");
			} else {
				searchX.classList.remove("svg-search");
				searchX.classList.add("svg-plainx");
				searchBox.parentElement!.classList.add("searching");
			}
		});
		const sideContainDiv = document.getElementById("sideContainDiv") as HTMLElement;
		searchBox.onclick = () => {
			sideContainDiv.classList.remove("hideSearchDiv");
		};
		searchX.onclick = () => {
			if (searchX.classList.contains("svg-plainx")) {
				markdown.txt = [];
				searchBox.innerHTML = "";
				searchX.classList.add("svg-search");
				searchBox.parentElement!.classList.remove("searching");
				searchX.classList.remove("svg-plainx");
				thisUser.mSearch("");
			} else if (searchBox.parentElement!.classList.contains("searching")) {
				// Already open but empty — close it
				searchBox.parentElement!.classList.remove("searching");
			} else {
				searchBox.parentElement!.classList.add("searching");
			}
		};

		markdown.giveBox(searchBox);
		markdown.setCustomBox((e) => {
			const span = document.createElement("span");
			span.textContent = e.replace("\n", "");
			return span;
		});
	}
	let images: Blob[] = [];
	let imagesHtml = new WeakMap<Blob, HTMLElement>();

	document.addEventListener("paste", async (e: ClipboardEvent) => {
		if (!thisUser.channelfocus) return;
		if (!e.clipboardData) return;

		for (const file of Array.from(e.clipboardData.files)) {
			const fileInstance = File.initFromBlob(file);
			e.preventDefault();
			const html = fileInstance.upHTML(images, imagesHtml, file);
			pasteImageElement.appendChild(html);
			images.push(file);
			imagesHtml.set(file, html);
		}
	});

	await setTheme();

	function userSettings(): void {
		thisUser.showusersettings();
	}

	(document.getElementById("settings") as HTMLImageElement).onclick = userSettings;
	const memberListToggle = document.getElementById("memberlisttoggle") as HTMLInputElement;
	memberListToggle.checked = !localStorage.getItem("memberNotChecked");
	memberListToggle.onchange = () => {
		if (!memberListToggle.checked) {
			localStorage.setItem("memberNotChecked", "true");
		} else {
			localStorage.removeItem("memberNotChecked");
		}
	};
	if (mobile) {
		const channelWrapper = document.getElementById("channelw") as HTMLDivElement;
		channelWrapper.onclick = () => {
			const toggle = document.getElementById("maintoggle") as HTMLInputElement;
			toggle.checked = true;
		};

		// Edge swipe on channelWrapper (fallback for empty channels with no message divs)
		{
			let swStartX = 0;
			let swStartY = 0;
			let swEdge = false;
			channelWrapper.addEventListener("touchstart", (e: TouchEvent) => {
				if (!e.touches[0]) return;
				swStartX = e.touches[0].clientX;
				swStartY = e.touches[0].clientY;
				swEdge = swStartX <= 30;
			}, {passive: true});
			channelWrapper.addEventListener("touchend", (e: TouchEvent) => {
				if (!swEdge || !e.changedTouches[0]) return;
				const dx = e.changedTouches[0].clientX - swStartX;
				const dy = e.changedTouches[0].clientY - swStartY;
				if (dx > 50 && Math.abs(dy) < 40) {
					const toggle = document.getElementById("maintoggle") as HTMLInputElement;
					if (toggle) toggle.checked = false;
				}
				swEdge = false;
			});
		}

		// When member list is open, swipe-right should behave like tapping header-left ">"
		// (close member list panel and reveal channel sidebar).
		const sideContainDiv = document.getElementById("sideContainDiv") as HTMLDivElement | null;
		if (sideContainDiv) {
			let startX = 0;
			let startY = 0;
			sideContainDiv.ontouchstart = (e: TouchEvent) => {
				if (!e.touches[0]) return;
				startX = e.touches[0].clientX;
				startY = e.touches[0].clientY;
			};
			sideContainDiv.ontouchend = (e: TouchEvent) => {
				if (!e.changedTouches[0]) return;
				const dx = e.changedTouches[0].clientX - startX;
				const dy = e.changedTouches[0].clientY - startY;
				if (dx > 50 && Math.abs(dy) < 40) {
					// Right swipe on member list should go back to message list only.
					memberListToggle.checked = false;
				}
			};
		}
		memberListToggle.checked = false;
	}
	let dragendtimeout = setTimeout(() => {});
	document.addEventListener("dragover", (e) => {
		clearTimeout(dragendtimeout);
		const data = e.dataTransfer;
		const bg = document.getElementById("gimmefile") as HTMLDivElement;

		if (data) {
			const isfile = data.types.includes("Files") || data.types.includes("application/x-moz-file");
			if (!isfile) {
				bg.hidden = true;
				return;
			}
			e.preventDefault();
			bg.hidden = false;
			//console.log(data.types,data)
		} else {
			bg.hidden = true;
		}
	});
	document.addEventListener("dragleave", (_) => {
		dragendtimeout = setTimeout(() => {
			const bg = document.getElementById("gimmefile") as HTMLDivElement;
			bg.hidden = true;
		}, 1000);
	});
	document.addEventListener("dragenter", (e) => {
		e.preventDefault();
	});
	document.addEventListener("drop", (e) => {
		const data = e.dataTransfer;
		const bg = document.getElementById("gimmefile") as HTMLDivElement;
		bg.hidden = true;
		if (!thisUser.channelfocus) {
			e.preventDefault();
			return;
		}
		if (data) {
			const isfile = data.types.includes("Files") || data.types.includes("application/x-moz-file");
			if (isfile) {
				e.preventDefault();
				console.log(data.files);
				for (const file of Array.from(data.files)) {
					const fileInstance = File.initFromBlob(file);
					const html = fileInstance.upHTML(images, imagesHtml, file);
					pasteImageElement.appendChild(html);
					images.push(file);
					imagesHtml.set(file, html);
				}
			}
		}
	});
	const pinnedM = document.getElementById("pinnedM") as HTMLElement;
	pinnedM.onclick = (e) => {
		thisUser.pinnedClick(pinnedM.getBoundingClientRect());
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	// Keep a persistent reference so iOS doesn't GC the input while camera is open
	let _uploadInput: HTMLInputElement | null = null;
	(document.getElementById("upload") as HTMLElement).onclick = () => {
		if (!thisUser.channelfocus) return;
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = "image/*,video/*,audio/*,*/*";
		// Append to DOM so iOS keeps it alive during camera/photo picker
		input.style.display = "none";
		document.body.appendChild(input);
		_uploadInput = input;
		input.onchange = () => {
			if (input.files) {
				for (const file of Array.from(input.files)) {
					const fileInstance = File.initFromBlob(file);
					const html = fileInstance.upHTML(images, imagesHtml, file);
					pasteImageElement.appendChild(html);
					images.push(file);
					imagesHtml.set(file, html);
				}
			}
			// Clean up
			input.remove();
			if (_uploadInput === input) _uploadInput = null;
		};
		input.click();
	};
	const emojiTB = document.getElementById("emojiTB") as HTMLElement;
	emojiTB.onmousedown = (e) => e.stopImmediatePropagation();
	emojiTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.TBEmojiMenu(emojiTB.getBoundingClientRect());
	};

	const gifTB = document.getElementById("gifTB") as HTMLElement;
	gifTB.onmousedown = (e) => e.stopImmediatePropagation();
	gifTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.makeGifBox(gifTB.getBoundingClientRect());
	};

	const stickerTB = document.getElementById("stickerTB") as HTMLElement;
	stickerTB.onmousedown = (e) => e.stopImmediatePropagation();
	stickerTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.makeStickerBox(stickerTB.getBoundingClientRect());
	};
	const updateIcon = document.getElementById("updateIcon");
	if (updateIcon) {
		new Hover(() => updateIcon.textContent || "").addEvent(updateIcon);
		updateIcon.onclick = () => {
			window.location.reload();
		};
	}
}
