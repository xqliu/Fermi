import type { Localuser } from "./localuser";
import type { Channel } from "./channel";

const MAX_BUBBLES = 4;

export class QuickSwitcher {
	private stack: Channel[] = [];
	private container: HTMLElement | null = null;
	private localuser: Localuser;

	constructor(localuser: Localuser) {
		this.localuser = localuser;
		this.container = document.getElementById("quick-bubbles");
		// DEBUG: force container + test bubble visible regardless of CSS
		if (this.container) {
			this.container.style.cssText = "display:flex !important; position:fixed; left:8px; bottom:80px; flex-direction:column; gap:8px; z-index:99999;";
			const test = document.createElement("div");
			test.style.cssText = "width:36px;height:36px;border-radius:50%;background:red;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:bold;";
			test.textContent = "QS";
			this.container.appendChild(test);
			console.log("[QS] container found, forced visible");
		} else {
			console.error("[QS] container NOT FOUND");
		}
	}

	/** Pre-populate stack with channels that already have unread messages on startup */
	preload(): void {
		const candidates: Channel[] = [];
		console.log("[QS] preload start, guilds:", this.localuser.guilds.length);
		for (const guild of this.localuser.guilds) {
			const chs = guild.channels ?? [];
			console.log("[QS] guild", guild.id, "channels:", chs.length);
			for (const channel of chs) {
				if (channel === this.localuser.channelfocus) continue;
				console.log("[QS] ch", channel.id, channel.name, "mentions:", channel.mentions, "hasunreads:", channel.hasunreads);
				if (channel.mentions > 0 || channel.hasunreads) {
					candidates.push(channel);
				}
			}
		}
		console.log("[QS] candidates:", candidates.length);
		// Sort: mentions first, then by channel id (rough recency proxy)
		candidates.sort((a, b) => (b.mentions - a.mentions) || (b.lastmessageid ?? "").localeCompare(a.lastmessageid ?? ""));
		for (const ch of candidates.slice(0, MAX_BUBBLES)) {
			this.stack.push(ch);
		}
		if (this.stack.length) this.render();
	}

	/** Called on every messageCreate — pushes channel to top of stack */
	push(channel: Channel): void {
		if (channel === this.localuser.channelfocus) return;
		// Dedup: move to top if already present
		this.stack = this.stack.filter((c) => c !== channel);
		this.stack.unshift(channel);
		if (this.stack.length > MAX_BUBBLES) this.stack.length = MAX_BUBBLES;
		this.render();
	}

	/** Called when user navigates to a channel — removes it from stack */
	remove(channel: Channel): void {
		const before = this.stack.length;
		this.stack = this.stack.filter((c) => c !== channel);
		if (this.stack.length !== before) this.render();
	}

	/** Re-render the bubble list */
	private render(): void {
		if (!this.container) return;
		this.container.innerHTML = "";
		for (const channel of this.stack) {
			this.container.appendChild(this.makeBubble(channel));
		}
	}

	private makeBubble(channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.classList.add("quick-bubble");
		div.title = channel.name;

		// Icon
		const icon = this.buildIcon(channel);
		div.appendChild(icon);

		// Unread badge
		if (channel.mentions > 0) {
			const badge = document.createElement("div");
			badge.classList.add("bubble-badge");
			badge.textContent = channel.mentions > 9 ? "9+" : String(channel.mentions);
			div.appendChild(badge);
		}

		// Click: navigate directly
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

		// Regular channel: show guild icon if available
		const guild = (channel as any).guild;
		const guildIcon = guild?.properties?.icon ?? guild?.icon;
		if (guild && guildIcon) {
			const img = document.createElement("img");
			img.src = `${guild.info.cdn}/icons/${guild.id}/${guildIcon}.png?size=64`;
			img.alt = guild.properties?.name ?? "";
			img.classList.add("quick-bubble-icon");
			return img;
		}

		// Fallback: coloured circle with first letter of channel name
		const span = document.createElement("div");
		span.classList.add("quick-bubble-fallback");
		span.textContent = (channel.name?.[0] ?? "#").toUpperCase();
		return span;
	}
}
