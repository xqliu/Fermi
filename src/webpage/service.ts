import {messageFrom, messageTo} from "./utils/serviceType";

// __BUILD_VERSION__ is replaced at build time with the git commit hash.
// This ensures the browser detects service.js has changed and installs the new SW.
const BUILD_VERSION = "__BUILD_VERSION__";
const SHELL_CACHE_PREFIX = "cache-";
const CURRENT_SHELL_CACHE = `${SHELL_CACHE_PREFIX}${BUILD_VERSION}`;
const REQUIRED_SHELL_PATHS = ["/app.html", "/index.js", "/getupdates"];
const FULL_SHELL_MARKER_PATH = "/__full-shell-ready__";
console.log("[SW] version:", BUILD_VERSION);

async function getActiveShellCacheName() {
	return CURRENT_SHELL_CACHE;
}
async function getShellCacheNamesNewestFirst(preferred = CURRENT_SHELL_CACHE) {
	const keys = (await caches.keys()).filter((key) => key.startsWith(SHELL_CACHE_PREFIX));
	const rest = keys.filter((key) => key !== preferred).reverse();
	return [preferred, ...rest];
}
async function deleteOldShellCaches(keep = CURRENT_SHELL_CACHE) {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== keep)
			.map((key) => caches.delete(key)),
	);
}
async function clearAllShellCaches() {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
			.map((key) => caches.delete(key)),
	);
}
async function hasCurrentShellCache() {
	const cache = await caches.open(CURRENT_SHELL_CACHE);
	const matches = await Promise.all(REQUIRED_SHELL_PATHS.map((path) => cache.match(new URL(path, self.location.origin))));
	return matches.every(Boolean);
}
async function hasFullShellCache(cacheName = CURRENT_SHELL_CACHE) {
	const cache = await caches.open(cacheName);
	return Boolean(await cache.match(new URL(FULL_SHELL_MARKER_PATH, self.location.origin)));
}
async function cacheRequiredShellFiles(cacheName = CURRENT_SHELL_CACHE) {
	for (const path of REQUIRED_SHELL_PATHS) {
		try {
			const response = await fetch(path, {cache: "no-store"});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} for ${path}`);
			}
			await putInCache(new URL(path, self.location.origin), response, cacheName);
		} catch (error) {
			console.error("[SW] failed to cache shell path:", path, error);
		}
	}
}
let ensureShellCachePromise: Promise<boolean> | undefined;
let ensureFullShellCachePromise: Promise<boolean> | undefined;
let pruneOldShellCachesPromise: Promise<void> | undefined;
let lastEnsureShellCacheAt = 0;
let lastEnsureFullShellAt = 0;
let oldCachesPruned = false;
type files = {[key: string]: string | files};
async function getAllFiles() {
	const files = await fetch("/files.json");
	const json: files = await files.json();
	return json;
}
// Directories that are large and loaded on-demand — skip during precache
const LAZY_DIRS = new Set(["/emoji"]);

async function cachePath(path: string, json: files, cacheName = CURRENT_SHELL_CACHE): Promise<boolean> {
	let success = true;
	for (const [name, thing] of Object.entries(json)) {
		try {
			if (typeof thing === "string") {
				const lpath = path + "/" + name;
				if (lpath.endsWith(".map") && !dev) {
					continue;
				}
				const res = await fetch(lpath, { cache: "no-store" });
				if (!res.ok) {
					throw new Error(`HTTP ${res.status} for ${lpath}`);
				}
				await putInCache(new URL(lpath, self.location.origin), res, cacheName);
			} else {
				const dirPath = path + "/" + name;
				if (LAZY_DIRS.has(dirPath)) {
					console.log("[SW] skipping lazy dir:", dirPath);
					continue;
				}
				success = (await cachePath(dirPath, thing, cacheName)) && success;
			}
		} catch (error) {
			success = false;
			console.error("[SW] failed to cache path:", path + "/" + name, error);
		}
	}
	return success;
}

async function downloadAllFiles(cacheName = CURRENT_SHELL_CACHE) {
	const json = await getAllFiles();
	return await cachePath("", json, cacheName);
}
async function markFullShellCacheReady(cacheName = CURRENT_SHELL_CACHE) {
	await putInCache(
		new URL(FULL_SHELL_MARKER_PATH, self.location.origin),
		new Response(BUILD_VERSION, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
			},
		}),
		cacheName,
	);
}
async function pruneOldShellCachesOnce() {
	if (oldCachesPruned) {
		return;
	}
	if (pruneOldShellCachesPromise) {
		return pruneOldShellCachesPromise;
	}
	pruneOldShellCachesPromise = (async () => {
		await deleteOldShellCaches(CURRENT_SHELL_CACHE);
		oldCachesPruned = true;
	})().finally(() => {
		pruneOldShellCachesPromise = undefined;
	});
	return pruneOldShellCachesPromise;
}
async function ensureFullShellCache(force = false): Promise<boolean> {
	if (!force && (await hasFullShellCache())) {
		await pruneOldShellCachesOnce();
		return true;
	}
	if (ensureFullShellCachePromise) {
		return ensureFullShellCachePromise;
	}
	const now = Date.now();
	if (!force && now - lastEnsureFullShellAt < 30000) {
		return false;
	}
	lastEnsureFullShellAt = now;
	ensureFullShellCachePromise = (async () => {
		try {
			console.log("[SW] backfilling full shell for", BUILD_VERSION);
			const complete = await downloadAllFiles(CURRENT_SHELL_CACHE);
			if (!complete) {
				console.warn("[SW] full shell backfill incomplete; keeping older caches");
				return false;
			}
			await markFullShellCacheReady(CURRENT_SHELL_CACHE);
			console.log("[SW] full shell ready for", BUILD_VERSION);
			await pruneOldShellCachesOnce();
			return true;
		} catch (error) {
			console.error("[SW] full shell backfill failed:", error);
			return false;
		} finally {
			ensureFullShellCachePromise = undefined;
		}
	})();
	return ensureFullShellCachePromise;
}
function backfillFullShellInBackground(reason: string) {
	void ensureFullShellCache().catch((error) =>
		console.error(`[SW] full shell background backfill failed (${reason}):`, error),
	);
}
async function ensureCurrentShellCache(force = false): Promise<boolean> {
	if (!force && (await hasCurrentShellCache())) {
		backfillFullShellInBackground("required shell already ready");
		return true;
	}
	if (ensureShellCachePromise) {
		return ensureShellCachePromise;
	}
	const now = Date.now();
	if (!force && now - lastEnsureShellCacheAt < 30000) {
		return false;
	}
	lastEnsureShellCacheAt = now;
	ensureShellCachePromise = (async () => {
		try {
			console.log("[SW] shell cache incomplete, backfilling required shell for current version");
			await cacheRequiredShellFiles(CURRENT_SHELL_CACHE);
			const ready = await hasCurrentShellCache();
			if (ready) {
				console.log("[SW] required shell ready for", BUILD_VERSION);
				backfillFullShellInBackground("required shell backfill complete");
			} else {
				console.warn("[SW] required shell still incomplete after backfill");
			}
			return ready;
		} catch (error) {
			console.error("[SW] required shell backfill failed:", error);
			return false;
		} finally {
			ensureShellCachePromise = undefined;
		}
	})();
	return ensureShellCachePromise;
}
async function getFromCache(request: URL, cacheName?: string) {
	request = new URL(request, self.location.href);
	const port = rMap.get(request.host);
	if (port) {
		request.search = "";
	}
	const cache = await caches.open(port ? "cdn" : cacheName || (await getActiveShellCacheName()));
	return cache.match(request);
}
async function getFromAnyShellCache(request: URL, preferredCacheName?: string) {
	request = new URL(request, self.location.href);
	const port = rMap.get(request.host);
	if (port) {
		const cache = await caches.open("cdn");
		return cache.match(request);
	}
	for (const cacheName of await getShellCacheNamesNewestFirst(preferredCacheName)) {
		const cache = await caches.open(cacheName);
		const match = await cache.match(request);
		if (match) {
			return match;
		}
	}
}
async function putInCache(request: URL | string, response: Response, cacheName?: string) {
	request = new URL(request, self.location.href);
	const port = rMap.get(request.host);
	if (port) {
		request.search = "";
	}
	const cache = await caches.open(port ? "cdn" : cacheName || CURRENT_SHELL_CACHE);

	try {
		console.log(await cache.put(request, response));
	} catch (error) {
		console.error(error);
	}
}

let lastcache: string;
self.addEventListener("install", (event: any) => {
	console.log("[SW] Installing, skip waiting");
	event.waitUntil(ensureCurrentShellCache(true).catch((e) => console.error("[SW] install precache failed:", e)));
	(self as any).skipWaiting();
});

self.addEventListener("activate", async (event: any) => {
	console.log("[SW] Activated, version:", BUILD_VERSION);
	event.waitUntil((async () => {
		const downloadOk = await ensureCurrentShellCache(true);
		await (self as any).clients.claim();
		if (downloadOk) {
			const clients = await (self as any).clients.matchAll();
			for (const client of clients) {
				client.postMessage({ code: "newVersion", version: BUILD_VERSION });
			}
		}
	})());
});
async function tryToClose() {
	const portArr = [...ports];
	if (portArr.length) {
		for (let i = 1; i < portArr.length; i++) {
			portArr[i].postMessage({code: "closing"});
		}
		portArr[0].postMessage({code: "close"});
	} else {
		throw new Error("No Fermi clients connected?");
	}
}
function sendAll(message: messageFrom) {
	for (const port of ports) {
		port.postMessage(message);
	}
}
async function checkCache() {
	if (checkedrecently) {
		return false;
	}
	const cache = await caches.open(await getActiveShellCacheName());
	const promise = await cache.match("/getupdates");
	if (promise) {
		lastcache = await promise.text();
	}
	console.log(lastcache);
	return fetch("/getupdates", { cache: "no-store" }).then(async (data) => {
		setTimeout(
			(_: any) => {
				checkedrecently = false;
			},
			1000 * 60 * 30,
		);
		if (!data.ok) return false;
		const text = await data.clone().text();
		console.log(text, lastcache);
		if (lastcache !== text) {
			await putInCache("/getupdates", data.clone(), CURRENT_SHELL_CACHE);
			lastcache = text;
			checkedrecently = true;
			sendAll({
				code: "updates",
				updates: true,
			});
			return true;
		}
		checkedrecently = true;
		return false;
	});
}
var checkedrecently = false;

function samedomain(url: string | URL) {
	return new URL(url).origin === self.origin;
}

let enabled = "false";
let offline = false;
function toPathNoDefault(url: string) {
	const Url = new URL(url);
	let html: string | undefined = undefined;
	const path = Url.pathname;
	if (path.startsWith("/channels") || path === "/app") {
		html = "/app.html";
	} else if (path.startsWith("/invite/") || path === "/invite") {
		html = "/invite.html";
	} else if (path.startsWith("/template/") || path === "/template") {
		html = "/template.html";
	} else if (path === "/") {
		html = "/app.html";
	}
	return html;
}
function toPath(url: string): string {
	const Url = new URL(url);
	return toPathNoDefault(url) || Url.pathname;
}
function isDocumentRequest(req: Request) {
	return req.mode === "navigate" || req.destination === "document" || req.headers.get("accept")?.includes("text/html");
}
function hasFileExtension(path: string) {
	return /\/[^/]+\.[^/]+$/.test(path);
}
function isForcedFreshAssetRequest(req: Request) {
	const url = new URL(req.url);
	return samedomain(req.url) && hasFileExtension(url.pathname) && url.searchParams.has("_cv");
}
async function getCachedNavigationFallback(req: Request) {
	const url = new URL(req.url);
	const paths = new Set<string>();
	const specific = toPathNoDefault(req.url);
	if (specific) {
		paths.add(specific);
	}
	if (url.pathname === "/") {
		paths.add("/index.html");
	}
	if (!hasFileExtension(url.pathname) && url.pathname !== "/") {
		paths.add(`${url.pathname}.html`);
		paths.add(`${url.pathname}/index.html`);
	}
	paths.add("/app.html");
	for (const path of paths) {
		const cached = await getFromAnyShellCache(new URL(path, self.location.origin));
		if (cached) {
			return cached;
		}
	}
}
function makeOfflineDocumentResponse() {
	return new Response(
		`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Offline</title>
	<style>
		body { font-family: sans-serif; margin: 0; background: #05050a; color: #fff; display: grid; min-height: 100vh; place-items: center; }
		main { max-width: 28rem; padding: 2rem; text-align: center; }
		p { color: #bbb; line-height: 1.5; }
	</style>
</head>
<body>
	<main>
		<h1>Offline</h1>
		<p>This page is not cached yet. Open it once while online, then it will be available offline.</p>
	</main>
</body>
</html>`,
		{
			status: 503,
			statusText: "Offline",
			headers: {"Content-Type": "text/html; charset=utf-8"},
		},
	);
}
let fails = 0;
async function getfile(req: Request): Promise<Response> {
	checkCache();
	if (!samedomain(req.url) || enabled === "false" || (enabled === "offlineOnly" && !offline)) {
		try {
			const response = await fetch(req.clone());
			if (samedomain(req.url)) {
				if (enabled === "offlineOnly" && response.ok) {
					putInCache(toPath(req.url), response.clone());
				}
				if (!response.ok) {
					fails++;
					if (fails > 5) {
						offline = true;
					}
				}
			}
			return response;
		} catch (e) {
			console.error("[SW] fetch failed for", req.url, e);
			// Try cache fallback before giving up
			const cached = await getFromAnyShellCache(new URL(toPath(req.url), self.location.origin));
			if (cached) return cached;
			if (samedomain(req.url) && isDocumentRequest(req)) {
				const navFallback = await getCachedNavigationFallback(req);
				if (navFallback) return navFallback;
				return makeOfflineDocumentResponse();
			}
			throw e; // no cache, rethrow — browser shows native error page
		}
	}

	let path = toPath(req.url);
	if (path === "/instances.json") {
		//TODO the client shouldn't really even fetch this, it should just ask the SW for it
		return await fetch(path);
	}
	if (isForcedFreshAssetRequest(req)) {
		try {
			const responseFromNetwork = await fetch(req.clone(), {cache: "no-store"});
			if (responseFromNetwork.ok) {
				await putInCache(path, responseFromNetwork.clone());
			}
			return responseFromNetwork;
		} catch (error) {
			console.warn("[SW] forced-fresh asset fetch failed, falling back to cache:", req.url, error);
			const cached = await getFromAnyShellCache(new URL(path, self.location.origin));
			if (cached) return cached;
			throw error;
		}
	}
	console.log("Getting path: " + path);
	const responseFromCache = await getFromCache(new URL(path, self.location.origin));
	if (responseFromCache) {
		console.log("cache hit");
		return responseFromCache;
	}
	try {
		const responseFromNetwork = await fetch(path);
		if (responseFromNetwork.ok) {
			await putInCache(path, responseFromNetwork.clone());
		}
		return responseFromNetwork;
	} catch (e) {
		console.error(e);
		const cached = await getFromAnyShellCache(new URL(path, self.location.origin));
		if (cached) {
			return cached;
		}
		if (isDocumentRequest(req)) {
			const navFallback = await getCachedNavigationFallback(req);
			if (navFallback) return navFallback;
			return makeOfflineDocumentResponse();
		}
		return new Response(null);
	}
}
const promURLMap = new Map<string, (url: string) => void>();
async function refreshUrl(url: URL, port: MessagePort): Promise<string> {
	port.postMessage({
		code: "refreshURL",
		url: url.toString(),
	});
	return new Promise((res) => promURLMap.set(url.toString(), res));
}
self.addEventListener("fetch", async (e) => {
	const event = e as FetchEvent;
	const host = URL.canParse(event.request.url) && new URL(event.request.url).host;
	let req = event.request;

	const port = rMap.get(host || "");
	if (port) {
		const url = new URL(event.request.url);
		const ignore = ["/api", "/_spacebar"].find((_) => url.pathname.startsWith(_));
		if (!ignore) {
			const expired =
				url.searchParams.get("ex") &&
				Number.parseInt(url.searchParams.get("ex") || "", 16) < Date.now() - 5000;
			event.respondWith(
				new Promise(async (res) => {
					const cached = await getFromCache(url);
					if (cached) {
						res(cached);
						return;
					}
					if (expired) {
						const old = url;
						const p = Date.now();
						req = await Promise.race<Request>([
							new Promise(async (res) => res(new Request(await refreshUrl(url, port), req))),
							new Promise((res) => setTimeout(() => res(req), 5000)),
						]);
						console.log(p - Date.now(), old === url);
					}
					const f = await fetch(req);
					res(f);
					putInCache(url, f.clone());
				}),
			);
			return;
		}
	}

	if (apiHosts?.has(host || "")) {
		try {
			const response = await fetch(req.clone());
			try {
				event.respondWith(response.clone());
			} catch {}

			const json = await response.json();
			if (json._trace) {
				sendAll({
					code: "trace",
					trace: json._trace,
				});
			}
		} catch (e) {
			console.error(e);
			//Wasn't meant to be ig lol
		}
		return;
	}

	if (req.method === "POST") {
		return;
	}
	const pathname = new URL(req.url).pathname;
	if (
		pathname.startsWith("/api/") ||
		pathname === "/getupdates" ||
		pathname === "/version.json" ||
		pathname === "/user-defaults.json" ||
		pathname === "/reset" ||
		pathname === "/reset.html" ||
		pathname === FULL_SHELL_MARKER_PATH
	) {
		return;
	}
	if (samedomain(req.url)) {
		event.waitUntil(ensureCurrentShellCache().catch((error) => console.error("[SW] background shell backfill failed:", error)));
	}
	try {
		event.respondWith(getfile(req));
	} catch (e) {
		console.error(e);
	}
});
const ports = new Set<MessagePort>();
let dev = false;
let apiHosts: Set<string> | void;
const rMap = new Map<string, MessagePort>();
function listenToPort(port: MessagePort) {
	function sendMessage(message: messageFrom) {
		port.postMessage(message);
	}
	port.onmessage = async (e) => {
		const data = e.data as messageTo;
		switch (data.code) {
			case "ping": {
				sendMessage({
					code: "pong",
					count: ports.size,
				});
				break;
			}
			case "close": {
				ports.delete(port);
				break;
			}
			case "replace": {
				//@ts-ignore-error Just the type or wrong or something
				self.skipWaiting();
				break;
			}
			case "CheckUpdate": {
				checkedrecently = false;
				if (!(await checkCache())) {
					sendMessage({
						code: "updates",
						updates: false,
					});
				}

				break;
			}
			case "isValid": {
				sendMessage({code: "isValid", url: data.url, valid: !!toPathNoDefault(data.url)});
				break;
			}
			case "isDev": {
				const refetch = !dev && data.dev;
				dev = data.dev;
				if (refetch) {
					getAllFiles();
				}
				break;
			}
			case "apiUrls": {
				if (data.hosts) {
					apiHosts = new Set(data.hosts);
				} else {
					apiHosts = undefined;
				}
				break;
			}
			case "canRefresh": {
				rMap.set(data.host, port);
				break;
			}
			case "refreshedUrl": {
				const res = promURLMap.get(data.oldurl);
				if (res) {
					res(data.url);
					promURLMap.delete(data.oldurl);
				}
			}
		}
	};
	port.addEventListener("close", () => {
		ports.delete(port);
	});
}
// --- Web Push Notifications ---
self.addEventListener("push", (event) => {
	const e = event as PushEvent;
	if (!e.data) return;
	let data: any;
	try {
		data = e.data.json();
	} catch {
		return;
	}

	e.waitUntil(
		(self as any).clients
			.matchAll({type: "window", includeUncontrolled: true})
			.then((clients: any[]) => {
				// Don't show notification if a Fermi window is focused
				const hasFocused = clients.some(
					(c: any) => c.visibilityState === "visible",
				);
				if (hasFocused) return;

				return (self as any).registration.showNotification(data.title || "Lucky 5L", {
					body: data.body || "",
					icon: data.icon || "/logo-192.webp",
					badge: "/logo-192.webp",
					data: data.data,
					tag: data.data?.url || "default",
				});
			}),
	);
});

self.addEventListener("notificationclick", (event) => {
	const e = event as NotificationEvent;
	e.notification.close();
	const url = e.notification.data?.url || "/channels/@me";

	e.waitUntil(
		(self as any).clients
			.matchAll({type: "window"})
			.then((clients: any[]) => {
				// Focus existing window if available
				for (const client of clients) {
					if ("focus" in client) {
						client.focus();
						client.navigate(url);
						return;
					}
				}
				// Otherwise open new window
				return (self as any).clients.openWindow(url);
			}),
	);
});

self.addEventListener("message", (message) => {
	const data = message.data;
	switch (data.code) {
		case "replace":
			(self as any).skipWaiting();
			break;
		case "setMode":
			enabled = data.data;
			break;
		case "ForceClear":
			clearAllShellCaches();
			break;
		case "clearCdnCache":
			caches.delete("cdn");
			break;
		case "port": {
			const port = data.port as MessagePort;
			ports.add(port);
			listenToPort(port);
		}
	}
});
