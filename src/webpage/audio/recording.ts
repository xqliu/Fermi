/**
 * Inject duration into a WebM blob's EBML Segment>Info>Duration field.
 * Chromium's MediaRecorder produces WebM without duration metadata;
 * this patches the binary to add it so any player reads it correctly.
 */
async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
	const buf = await blob.arrayBuffer();
	const view = new DataView(buf);

	// Find Segment element (EBML ID 0x18538067)
	let pos = 0;
	const len = buf.byteLength;

	function matchId(offset: number, id: number[]): boolean {
		for (let i = 0; i < id.length; i++) {
			if (offset + i >= len || view.getUint8(offset + i) !== id[i]) return false;
		}
		return true;
	}

	// Find Info element (0x1549A966) inside Segment
	// Then find Duration (0x4489) inside Info
	// If Duration exists, overwrite it. If not, we fall back to filename approach.
	for (pos = 0; pos < len - 8; pos++) {
		// Duration element ID: 0x44 0x89
		if (view.getUint8(pos) === 0x44 && view.getUint8(pos + 1) === 0x89) {
			// Next byte(s) = VINT size of the float payload
			const sizeStart = pos + 2;
			if (sizeStart >= len) break;
			const sizeByte = view.getUint8(sizeStart);
			// Common case: 0x88 = 8 bytes (float64), 0x84 = 4 bytes (float32)
			if (sizeByte === 0x88 && sizeStart + 1 + 8 <= len) {
				// Overwrite the float64 duration
				view.setFloat64(sizeStart + 1, durationMs);
				return new Blob([buf], { type: blob.type });
			} else if (sizeByte === 0x84 && sizeStart + 1 + 4 <= len) {
				view.setFloat32(sizeStart + 1, durationMs);
				return new Blob([buf], { type: blob.type });
			}
		}
	}

	// Duration field not found — return original blob unchanged
	return blob;
}

/**
 * Voice recording using browser MediaRecorder API.
 * iOS Safari requires audio/mp4; Chrome/Firefox use audio/webm.
 */
export class VoiceRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private _startTime = 0;
	private _timerInterval: ReturnType<typeof setInterval> | null = null;
	onTick: ((elapsed: number) => void) | null = null;

	get isRecording(): boolean {
		return this.mediaRecorder?.state === "recording";
	}

	get elapsed(): number {
		if (!this._startTime) return 0;
		return Math.floor((Date.now() - this._startTime) / 1000);
	}

	static get supported(): boolean {
		return !!(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
	}

	private get mimeType(): string {
		if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
			return "audio/webm;codecs=opus";
		}
		return "audio/mp4";
	}

	private get extension(): string {
		return this.mimeType.includes("webm") ? "webm" : "m4a";
	}

	async start(): Promise<void> {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.chunks = [];
		this._startTime = Date.now();
		this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		this.mediaRecorder.start(250); // collect data every 250ms for responsiveness
		this._timerInterval = setInterval(() => {
			if (this.onTick) this.onTick(this.elapsed);
		}, 500);
	}

	stop(): Promise<{ file: File; duration: number }> {
		return this._finish(false);
	}

	cancel(): void {
		this._finish(true);
	}

	private async _finish(discard: boolean): Promise<{ file: File; duration: number }> {
		const duration = this.elapsed;
		if (this._timerInterval) {
			clearInterval(this._timerInterval);
			this._timerInterval = null;
		}
		if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
			this.mediaRecorder.stop();
		}
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
			this.stream = null;
		}

		let file: File;
		if (discard || this.chunks.length === 0) {
			file = new File([], "recording." + this.extension, { type: this.mimeType });
		} else {
			let blob: Blob = new Blob(this.chunks, { type: this.mimeType });
			// Inject duration into WebM header so players can read it
			if (this.mimeType.includes("webm") && duration > 0) {
				try {
					blob = await fixWebmDuration(blob, duration * 1000);
				} catch (e) {
					console.warn("[voice] failed to fix webm duration:", e);
				}
			}
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			file = new File([blob], `voice-${timestamp}-${duration}s.${this.extension}`, { type: this.mimeType });
		}

		this.chunks = [];
		this.mediaRecorder = null;
		this._startTime = 0;
		return { file, duration };
	}
}
