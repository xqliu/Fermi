import {File} from "./file.js";
import {removeAni} from "./utils/utils.js";

class ImagesDisplay {
	files: File[];
	index = 0;
	// zoom/pan state
	private scale = 1;
	private translateX = 0;
	private translateY = 0;
	private isPanning = false;
	private panStartX = 0;
	private panStartY = 0;
	private lastTranslateX = 0;
	private lastTranslateY = 0;
	// pinch state
	private lastPinchDist = 0;
	private pinchCenterX = 0;
	private pinchCenterY = 0;

	constructor(files: File[], index = 0) {
		this.files = files;
		this.index = index;
	}
	weakbg = new WeakRef<HTMLElement>(document.createElement("div"));
	get background(): HTMLElement | undefined {
		return this.weakbg.deref();
	}
	set background(e: HTMLElement) {
		this.weakbg = new WeakRef(e);
	}
	private resetZoom() {
		this.scale = 1;
		this.translateX = 0;
		this.translateY = 0;
		this.lastTranslateX = 0;
		this.lastTranslateY = 0;
	}
	private applyTransform(el: HTMLElement) {
		el.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
	}
	private setupZoom(wrapper: HTMLElement, imgEl: HTMLElement) {
		wrapper.style.overflow = "hidden";
		wrapper.style.touchAction = "none";
		imgEl.style.transformOrigin = "center center";
		imgEl.style.transition = "none";
		imgEl.style.willChange = "transform";

		// Wheel zoom
		wrapper.addEventListener("wheel", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const delta = e.deltaY > 0 ? 0.9 : 1.1;
			const newScale = Math.min(Math.max(this.scale * delta, 0.5), 10);
			// zoom toward cursor
			const rect = wrapper.getBoundingClientRect();
			const cx = e.clientX - rect.left - rect.width / 2;
			const cy = e.clientY - rect.top - rect.height / 2;
			const ratio = 1 - newScale / this.scale;
			this.translateX += (cx - this.translateX) * ratio;
			this.translateY += (cy - this.translateY) * ratio;
			this.scale = newScale;
			this.lastTranslateX = this.translateX;
			this.lastTranslateY = this.translateY;
			this.applyTransform(imgEl);
		}, {passive: false});

		// Touch: pinch zoom + pan
		wrapper.addEventListener("touchstart", (e) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				this.lastPinchDist = Math.hypot(dx, dy);
				const rect = wrapper.getBoundingClientRect();
				this.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width / 2;
				this.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - rect.height / 2;
			} else if (e.touches.length === 1 && this.scale > 1) {
				e.preventDefault();
				this.isPanning = true;
				this.panStartX = e.touches[0].clientX;
				this.panStartY = e.touches[0].clientY;
				this.lastTranslateX = this.translateX;
				this.lastTranslateY = this.translateY;
			}
		}, {passive: false});

		wrapper.addEventListener("touchmove", (e) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				const dx = e.touches[0].clientX - e.touches[1].clientX;
				const dy = e.touches[0].clientY - e.touches[1].clientY;
				const dist = Math.hypot(dx, dy);
				if (this.lastPinchDist > 0) {
					const delta = dist / this.lastPinchDist;
					const newScale = Math.min(Math.max(this.scale * delta, 0.5), 10);
					const ratio = 1 - newScale / this.scale;
					this.translateX += (this.pinchCenterX - this.translateX) * ratio;
					this.translateY += (this.pinchCenterY - this.translateY) * ratio;
					this.scale = newScale;
					this.lastTranslateX = this.translateX;
					this.lastTranslateY = this.translateY;
					this.applyTransform(imgEl);
				}
				this.lastPinchDist = dist;
			} else if (e.touches.length === 1 && this.isPanning) {
				e.preventDefault();
				this.translateX = this.lastTranslateX + (e.touches[0].clientX - this.panStartX);
				this.translateY = this.lastTranslateY + (e.touches[0].clientY - this.panStartY);
				this.applyTransform(imgEl);
			}
		}, {passive: false});

		wrapper.addEventListener("touchend", (e) => {
			if (e.touches.length < 2) {
				this.lastPinchDist = 0;
			}
			if (e.touches.length === 0) {
				this.isPanning = false;
				this.lastTranslateX = this.translateX;
				this.lastTranslateY = this.translateY;
			}
		});

		// Mouse drag pan (when zoomed)
		wrapper.addEventListener("mousedown", (e) => {
			if (this.scale > 1) {
				e.preventDefault();
				e.stopPropagation();
				this.isPanning = true;
				this.panStartX = e.clientX;
				this.panStartY = e.clientY;
				this.lastTranslateX = this.translateX;
				this.lastTranslateY = this.translateY;
				wrapper.style.cursor = "grabbing";
			}
		});
		wrapper.addEventListener("mousemove", (e) => {
			if (this.isPanning && this.scale > 1) {
				e.preventDefault();
				this.translateX = this.lastTranslateX + (e.clientX - this.panStartX);
				this.translateY = this.lastTranslateY + (e.clientY - this.panStartY);
				this.applyTransform(imgEl);
			}
		});
		wrapper.addEventListener("mouseup", () => {
			this.isPanning = false;
			this.lastTranslateX = this.translateX;
			this.lastTranslateY = this.translateY;
			wrapper.style.cursor = "";
		});

		// Double-click/tap to reset
		imgEl.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.scale !== 1) {
				this.resetZoom();
			} else {
				this.scale = 2.5;
				const rect = wrapper.getBoundingClientRect();
				this.translateX = (rect.width / 2 - e.clientX + rect.left);
				this.translateY = (rect.height / 2 - e.clientY + rect.top);
				this.lastTranslateX = this.translateX;
				this.lastTranslateY = this.translateY;
			}
			this.applyTransform(imgEl);
		});
	}
	makeHTML(): HTMLElement {
		const image = this.files[this.index].getHTML(false, true);
		image.classList.add("imgfit", "centeritem");
		return image;
	}
	show() {
		this.background = document.createElement("div");
		this.background.classList.add("background");
		this.resetZoom();
		let cur = this.makeHTML();

		const switchImage = () => {
			this.resetZoom();
			cur.remove();
			cur = this.makeHTML();
			if (this.background) {
				this.background.appendChild(cur);
				this.setupZoom(this.background, cur);
			}
		};

		if (this.files.length !== 1) {
			const right = document.createElement("span");
			right.classList.add("rightArrow", "svg-intoMenu");
			right.onclick = (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.index++;
				this.index %= this.files.length;
				switchImage();
			};

			const left = document.createElement("span");
			left.onclick = (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.index += this.files.length - 1;
				this.index %= this.files.length;
				switchImage();
			};
			left.classList.add("leftArrow", "svg-leftArrow");
			this.background.append(right, left);
			this.background.addEventListener("keydown", (e) => {
				if (e.key === "ArrowRight") {
					e.preventDefault();
					e.stopImmediatePropagation();
					right.click();
				}
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					e.stopImmediatePropagation();
					left.click();
				}
			});
		}

		this.background.appendChild(cur);
		// Close only on background click when not zoomed, and not after a pan
		this.background.onclick = (e) => {
			if (this.scale <= 1 && e.target === this.background) {
				this.hide();
			}
		};
		this.background.onkeydown = (e) => {
			if (e.key === "Escape") {
				this.hide();
			}
		};
		document.body.append(this.background);
		this.background.setAttribute("tabindex", "0");
		this.background.focus();
		this.setupZoom(this.background, cur);
	}
	hide() {
		if (this.background) {
			removeAni(this.background);
		}
	}
}
export {ImagesDisplay};
