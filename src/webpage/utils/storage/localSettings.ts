export const enum ServiceWorkerMode {
	// Skips registering the service worker completely
	Unregistered = "unregistered",
	// Registers the service worker but does not activate it
	Disabled = "disabled",
	// Ensures client files are cached and used when offline
	OfflineOnly = "offlineOnly",
	// Cache everything and use cached files when possible
	Enabled = "enabled",
}

export const ServiceWorkerModeValues = [
	ServiceWorkerMode.Unregistered,
	ServiceWorkerMode.Disabled,
	ServiceWorkerMode.OfflineOnly,
	ServiceWorkerMode.Enabled,
];

export class LocalSettings {
	serviceWorkerMode: ServiceWorkerMode = ServiceWorkerMode.Enabled;
	constructor(init?: Partial<LocalSettings>) {
		Object.assign(this, init);
	}
}

export function getLocalSettings(): LocalSettings {
	return new LocalSettings(JSON.parse(localStorage.getItem("localSettings") || "{}"));
}

export function setLocalSettings(settings: LocalSettings): void {
	localStorage.setItem("localSettings", JSON.stringify(settings));
}

//region Migration from untyped storage
function migrateOldSettings() {
	const settings = getLocalSettings();
	let mod = false;

	const oldSWMode = localStorage.getItem("SWMode");
	if (oldSWMode !== null) {
		settings.serviceWorkerMode = oldSWMode as ServiceWorkerMode;
		localStorage.removeItem("SWMode");
		mod = true;
	}

	// Force-enable SW for users stuck on Unregistered
	if (settings.serviceWorkerMode === ServiceWorkerMode.Unregistered) {
		settings.serviceWorkerMode = ServiceWorkerMode.Enabled;
		mod = true;
	}

	if (mod) {
		localStorage.setItem("localSettings", JSON.stringify(settings));
	}
}

migrateOldSettings();
//endregion
