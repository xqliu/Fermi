import type { Localuser } from "./localuser";
import type { Channel } from "./channel";

const MAX_BUBBLES = 4;
const STORAGE_KEY = "qs_recents";

export class QuickSwitcher {
	private recents: string[] = []; // channel IDs, ordered most-recent first (persisted)
	private _sessionExtra: string[] = []; // unread channels surfaced this session only (not persisted)
	private container: HTMLElement | null = null;
	private localuser: Localuser;

	constructor(localuser: Localuser) {
		this.localuser = localuser;
		this.container = document.getElementById("quick-bubbles");
		this._loadStorage();
	}

	// ── Persistence ──────────────────────────────────────────────

	private _loadStorage(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.recents = JSON.parse(raw);
		} catch { /* ignore */ }
	}

	private _saveStorage(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recents));
		} catch { /* ignore */ }
	}

	// ── Public API ────────────────────────────────────────────────

	/** Called on startup after guild data is loaded — refresh badges with current unread state.
	 *  Also surfaces any channels with unreads/mentions not yet in recents (session-only, not persisted). */
	refreshBadges(): void {
		const currentId = this.localuser.channelfocus?.id;
		// Collect unread channels not already in recents (don't persist these)
		const unreadExtra: string[] = [];
		for (const guild of this.localuser.guilds) {
			for (const channel of guild.channels ?? []) {
				if (channel.id === currentId) continue;
				if ((channel.mentions > 0 || channel.hasunreads) && !this.recents.includes(channel.id)) {
					unreadExtra.push(channel.id);
				}
			}
		}
		this._sessionExtra = unreadExtra;
		this.render();
	}

	/** Called when user navigates to a channel.
	 *  Previous focus is added to recents; new focus is removed from bubbles. */
	onChannelFocus(prev: Channel | null, next: Channel): void {
		// Add the channel we just left to recents
		if (prev && prev !== next) {
			this.recents = this.recents.filter(id => id !== prev.id);
			this.recents.unshift(prev.id);
			if (this.recents.length > MAX_BUBBLES * 2) this.recents.length = MAX_BUBBLES * 2;
			this._saveStorage();
		}
		// Remove the channel we're entering from bubble display (we're already there)
		this.render();
	}

	/** Called on messageCreate — surfaces unread channels not yet in recents */
	push(channel: Channel): void {
		if (channel === this.localuser.channelfocus) {
			// User is currently in this channel (e.g. sending a DM) — add to recents
			// so it shows as a bubble after they navigate away
			if (!this.recents.includes(channel.id)) {
				this.recents.push(channel.id); // append to back, lower priority than explicit navigation
				if (this.recents.length > MAX_BUBBLES * 2) this.recents.length = MAX_BUBBLES * 2;
				this._saveStorage();
			}
			return; // don't render bubble while user is still here
		}
		if (!this.recents.includes(channel.id)) {
			this.recents.unshift(channel.id);
			if (this.recents.length > MAX_BUBBLES * 2) this.recents.length = MAX_BUBBLES * 2;
			this._saveStorage();
		}
		this.render();
	}

	// ── Rendering ─────────────────────────────────────────────────

	private render(): void {
		if (!this.container) return;
		this.container.innerHTML = "";

		const currentId = this.localuser.channelfocus?.id;
		let shown = 0;
		const seen = new Set<string>();

		// recents first (visited channels), then session-only unread extras
		for (const id of [...this.recents, ...this._sessionExtra]) {
			if (shown >= MAX_BUBBLES) break;
			if (id === currentId || seen.has(id)) continue;
			seen.add(id);
			const channel = this.localuser.channelids.get(id);
			if (!channel) continue;
			this.container.appendChild(this.makeBubble(channel));
			shown++;
		}
	}

	private makeBubble(channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.classList.add("quick-bubble");
		div.title = channel.name;

		// Icon wrapper (for badge positioning)
		const iconWrap = document.createElement("div");
		iconWrap.classList.add("quick-bubble-icon-wrap");
		iconWrap.appendChild(this.buildIcon(channel));

		// Badge: number for mentions, dot for plain unreads
		if (channel.mentions > 0) {
			const badge = document.createElement("div");
			badge.classList.add("bubble-badge");
			badge.textContent = channel.mentions > 9 ? "9+" : String(channel.mentions);
			iconWrap.appendChild(badge);
		} else if (channel.hasunreads) {
			const dot = document.createElement("div");
			dot.classList.add("bubble-badge", "bubble-badge-dot");
			iconWrap.appendChild(dot);
		}
		div.appendChild(iconWrap);

		// Channel name label
		const label = document.createElement("div");
		label.classList.add("quick-bubble-label");
		label.textContent = channel.name ?? "";
		div.appendChild(label);

		// Click: navigate
		div.addEventListener("click", () => {
			const toggle = document.getElementById("maintoggle") as HTMLInputElement | null;
			if (toggle) toggle.checked = true;
			this.localuser.goToChannel(channel.id);
		});

		return div;
	}

	private buildIcon(channel: Channel): HTMLElement {
		// DM channels (Group extends Channel, has makeIcon())
		const ch = channel as any;
		if (typeof ch.makeIcon === "function") {
			// type=1: single DM — grab avatar img directly for clean sizing
			if (ch.type === 1 && Array.isArray(ch.users) && ch.users[0]) {
				const user = ch.users[0];
				const src = typeof user.getpfpsrc === "function" ? user.getpfpsrc() : null;
				if (src) {
					const img = document.createElement("img");
					img.src = src;
					img.alt = user.name ?? "";
					img.classList.add("quick-bubble-icon");
					img.onerror = () => {
						// fallback if avatar fails to load
						const fb = document.createElement("div");
						fb.classList.add("quick-bubble-fallback");
						fb.textContent = (user.name?.[0] ?? "?").toUpperCase();
						img.replaceWith(fb);
					};
					return img;
				}
			}
			// Group DM: wrap makeIcon() output
			const wrap = document.createElement("div");
			wrap.classList.add("quick-bubble-icon");
			wrap.style.cssText = "width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;";
			const icon = ch.makeIcon() as HTMLElement;
			icon.style.cssText = "width:32px;height:32px;";
			wrap.appendChild(icon);
			return wrap;
		}

		// Guild channel: show guild icon
		const guild = ch.guild;
		const guildIcon = guild?.properties?.icon ?? guild?.icon;
		if (guild && guildIcon) {
			const img = document.createElement("img");
			img.src = `${guild.info.cdn}/icons/${guild.id}/${guildIcon}.png?size=64`;
			img.alt = guild.properties?.name ?? "";
			img.classList.add("quick-bubble-icon");
			return img;
		}

		// Fallback: coloured circle with guild/channel initial
		const span = document.createElement("div");
		span.classList.add("quick-bubble-fallback");
		span.textContent = ((guild?.properties?.name ?? channel.name)?.[0] ?? "#").toUpperCase();
		return span;
	}
}
