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
		if (channel === this.localuser.channelfocus) return;
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

		// Icon
		div.appendChild(this.buildIcon(channel));

		// Badge: number for mentions, dot for plain unreads
		if (channel.mentions > 0) {
			const badge = document.createElement("div");
			badge.classList.add("bubble-badge");
			badge.textContent = channel.mentions > 9 ? "9+" : String(channel.mentions);
			div.appendChild(badge);
		} else if (channel.hasunreads) {
			const dot = document.createElement("div");
			dot.classList.add("bubble-badge", "bubble-badge-dot");
			div.appendChild(dot);
		}

		// Click: navigate
		div.addEventListener("click", () => {
			const toggle = document.getElementById("maintoggle") as HTMLInputElement | null;
			if (toggle) toggle.checked = true;
			this.localuser.goToChannel(channel.id);
		});

		return div;
	}

	private buildIcon(channel: Channel): HTMLElement {
		// DM / Group DM: use existing makeIcon()
		if (typeof (channel as any).makeIcon === "function") {
			const icon = (channel as any).makeIcon() as HTMLElement;
			icon.classList.add("quick-bubble-icon");
			return icon;
		}

		// Guild channel: unique coloured circle with channel initial
		const span = document.createElement("div");
		span.classList.add("quick-bubble-fallback");
		span.textContent = (channel.name?.[0] ?? "#").toUpperCase();
		span.style.background = QuickSwitcher._channelColor(channel.id);
		return span;
	}

	/** Deterministic color from channel ID — same channel always gets same color */
	private static _channelColor(id: string): string {
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
		}
		const hue = hash % 360;
		return `hsl(${hue}, 55%, 45%)`;
	}
}
