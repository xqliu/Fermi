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

	stop(): { file: File; duration: number } {
		return this._finish(false);
	}

	cancel(): void {
		this._finish(true);
	}

	private _finish(discard: boolean): { file: File; duration: number } {
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
			const blob = new Blob(this.chunks, { type: this.mimeType });
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			file = new File([blob], `voice-${timestamp}-${duration}s.${this.extension}`, { type: this.mimeType });
		}

		this.chunks = [];
		this.mediaRecorder = null;
		this._startTime = 0;
		return { file, duration };
	}
}
