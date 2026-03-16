import type { Localuser } from "./localuser";
import type { Channel } from "./channel";

const MAX_BUBBLES = 5;
const STORAGE_KEY = "qs_recents";

export class QuickSwitcher {
	private recents: string[] = []; // channel IDs, ordered most-recent first (persisted)
	private _sessionExtra: string[] = []; // unread channels surfaced this session only (not persisted)
	private container: HTMLElement | null = null;
	private localuser: Localuser;

	private isBubbleEligible(channel: Channel): boolean {
		// Only show navigable channels that have a message timeline.
		// Exclude category / voice / stage placeholders that can land on empty views.
		if (!channel.visible) return false;
		return channel.type !== 4 && channel.type !== 2 && channel.type !== 13;
	}

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
				if (!this.isBubbleEligible(channel)) continue;
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
		if (!this.isBubbleEligible(channel)) return;
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
		// New message = promote to front, bumping the oldest bubble if full
		this.recents = this.recents.filter(id => id !== channel.id);
		this.recents.unshift(channel.id);
		if (this.recents.length > MAX_BUBBLES * 2) this.recents.length = MAX_BUBBLES * 2;
		this._saveStorage();
		this.render();
	}

	// ── Rendering ─────────────────────────────────────────────────

	private render(): void {
		if (!this.container) return;

		const currentId = this.localuser.channelfocus?.id;
		const seen = new Set<string>();

		// Collect all candidates (recents + sessionExtra, deduped)
		const candidates: Channel[] = [];
		for (const id of [...this.recents, ...this._sessionExtra]) {
			if (id === currentId || seen.has(id)) continue;
			seen.add(id);
			const channel = this.localuser.channelids.get(id);
			if (!channel || !this.isBubbleEligible(channel)) continue;
			candidates.push(channel);
		}

		// Sort by priority: mentions > hasunreads > plain recents
		candidates.sort((a, b) => {
			const pa = a.mentions > 0 ? 2 : a.hasunreads ? 1 : 0;
			const pb = b.mentions > 0 ? 2 : b.hasunreads ? 1 : 0;
			return pb - pa;
		});

		const wanted = candidates.slice(0, MAX_BUBBLES);
		const wantedIds = new Set(wanted.map(c => c.id));

		// Remove bubbles no longer needed
		for (const el of Array.from(this.container.children)) {
			const htm = el as HTMLElement;
			// Skip non-bubble elements (e.g. jump-to-bottom button)
			if (htm.classList.contains("jump-to-bottom")) continue;
			const id = htm.dataset.channelId;
			if (!id || !wantedIds.has(id)) el.remove();
		}

		// Update badges on existing + add new bubbles in correct order
		wanted.forEach((channel, i) => {
			const existing = this.container!.querySelector(`[data-channel-id="${channel.id}"]`) as HTMLElement | null;
			if (existing) {
				// Update badge only, no animation
				this._updateBadge(existing, channel);
				// Reorder if needed
				if (this.container!.children[i] !== existing) {
					this.container!.insertBefore(existing, this.container!.children[i] ?? null);
				}
			} else {
				// New bubble — insert with animation
				const el = this.makeBubble(channel);
				this.container!.insertBefore(el, this.container!.children[i] ?? null);
			}
		});
	}

	private _updateBadge(bubble: HTMLElement, channel: Channel): void {
		const wrap = bubble.querySelector(".quick-bubble-icon-wrap") as HTMLElement;
		if (!wrap) return;
		// Remove existing badge
		wrap.querySelector(".bubble-badge")?.remove();
		// Re-add if needed
		if (channel.mentions > 0) {
			const badge = document.createElement("div");
			badge.classList.add("bubble-badge");
			badge.textContent = channel.mentions > 9 ? "9+" : String(channel.mentions);
			wrap.appendChild(badge);
		} else if (channel.hasunreads) {
			const dot = document.createElement("div");
			dot.classList.add("bubble-badge", "bubble-badge-dot");
			wrap.appendChild(dot);
		}
	}

	private makeBubble(channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.classList.add("quick-bubble");
		div.dataset.channelId = channel.id;
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

		// Click: navigate + force-fetch latest messages (bubble = unread indicator)
		div.addEventListener("click", async () => {
			const toggle = document.getElementById("maintoggle") as HTMLInputElement | null;
			if (toggle) toggle.checked = true;

			// If already viewing this channel, skip full getHTML — just fetch new messages
			if (this.localuser.channelfocus === channel) {
				await channel.putmessages(true);
				if (channel.lastmessageid) {
					channel.infinite.focus(channel.lastmessageid, false, true);
				}
				return;
			}
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
		if (guild && guildIcon && guild.info?.cdn) {
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
