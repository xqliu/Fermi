import {messagejson, readyjson} from "../../jsontypes.js";

const DB_NAME = "fermi-offline-cache";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const MESSAGE_STORE = "messages";
const CHANNEL_STATE_STORE = "channelStates";
const MESSAGE_LIMIT = 100;

type OfflineReadySnapshot = {
	user: readyjson["d"]["user"];
	user_settings: readyjson["d"]["user_settings"];
	guilds: readyjson["d"]["guilds"];
	users: readyjson["d"]["users"];
	relationships: readyjson["d"]["relationships"];
	read_state?: readyjson["d"]["read_state"];
	user_guild_settings?: readyjson["d"]["user_guild_settings"];
	private_channels: readyjson["d"]["private_channels"];
	merged_members?: readyjson["d"]["merged_members"];
	country_code?: readyjson["d"]["country_code"];
	api_code_version?: readyjson["d"]["api_code_version"];
};

type SnapshotRecord = {
	scope: string;
	snapshot: OfflineReadySnapshot;
	updatedAt: number;
};

type MessageRecord = {
	id: string;
	scope: string;
	scopeChannel: string;
	channelId: string;
	messageId: string;
	sortKey: string;
	message: messagejson;
};

type ChannelStateRecord = {
	id: string;
	scope: string;
	channelId: string;
	allTheWayUp: boolean;
	updatedAt: number;
};

type CachedChannelMessages = {
	messages: messagejson[];
	allTheWayUp: boolean;
};

let dbPromise: Promise<IDBDatabase> | undefined;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

function getDb(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
					db.createObjectStore(SNAPSHOT_STORE, {keyPath: "scope"});
				}
				if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
					const store = db.createObjectStore(MESSAGE_STORE, {keyPath: "id"});
					store.createIndex("byScopeChannel", "scopeChannel", {unique: false});
				}
				if (!db.objectStoreNames.contains(CHANNEL_STATE_STORE)) {
					db.createObjectStore(CHANNEL_STATE_STORE, {keyPath: "id"});
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	return dbPromise;
}

function makeChannelKey(scope: string, channelId: string): string {
	return `${scope}::${channelId}`;
}

function sortMessagesNewestFirst(messages: messagejson[]): messagejson[] {
	return [...messages].sort((a, b) => {
		try {
			if (a.id === b.id) return 0;
			return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
		} catch {
			if (a.id === b.id) return 0;
			return b.id.localeCompare(a.id);
		}
	});
}

async function getMessageKeysForChannel(
	store: IDBObjectStore,
	scope: string,
	channelId: string,
): Promise<string[]> {
	const index = store.index("byScopeChannel");
	const range = IDBKeyRange.only(makeChannelKey(scope, channelId));
	return requestToPromise(index.getAllKeys(range)).then((keys) => keys as string[]);
}

export function getOfflineScope(userKey: string): string {
	return userKey;
}

export function makeOfflineReady(ready: readyjson): OfflineReadySnapshot {
	return {
		user: ready.d.user,
		user_settings: ready.d.user_settings,
		guilds: ready.d.guilds,
		users: ready.d.users,
		relationships: ready.d.relationships,
		read_state: ready.d.read_state,
		user_guild_settings: ready.d.user_guild_settings,
		private_channels: ready.d.private_channels,
		merged_members: ready.d.merged_members,
		country_code: ready.d.country_code,
		api_code_version: ready.d.api_code_version,
	};
}

export function snapshotToReady(snapshot: OfflineReadySnapshot): readyjson {
	return {
		op: 0,
		t: "READY",
		s: 0,
		d: {
			_trace: [],
			v: 9,
			user: snapshot.user,
			user_settings: snapshot.user_settings,
			guilds: snapshot.guilds,
			users: snapshot.users || [],
			relationships: snapshot.relationships,
			read_state:
				snapshot.read_state || {
					entries: [],
					partial: false,
					version: 0,
				},
			user_guild_settings:
				snapshot.user_guild_settings || {
					entries: [],
					partial: false,
					version: 0,
				},
			private_channels: snapshot.private_channels,
			session_id: "",
			country_code: snapshot.country_code || "",
			merged_members: snapshot.merged_members || [],
			sessions: [],
			resume_gateway_url: "",
			consents: {
				personalization: {
					consented: false,
				},
			},
			experiments: [],
			guild_join_requests: [],
			connected_accounts: [],
			guild_experiments: [],
			geo_ordered_rtc_regions: [],
			api_code_version: snapshot.api_code_version || 0,
			friend_suggestion_count: 0,
			analytics_token: "",
			tutorial: false,
			session_type: "",
			auth_session_id_hash: "",
			notification_settings: {
				flags: 0,
			},
		},
	};
}

export async function saveOfflineReady(scope: string, ready: readyjson): Promise<void> {
	const db = await getDb();
	const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
	const store = transaction.objectStore(SNAPSHOT_STORE);
	const record: SnapshotRecord = {
		scope,
		snapshot: makeOfflineReady(ready),
		updatedAt: Date.now(),
	};
	store.put(record);
	await transactionDone(transaction);
}

export async function loadOfflineReady(scope: string): Promise<readyjson | undefined> {
	const db = await getDb();
	const transaction = db.transaction(SNAPSHOT_STORE, "readonly");
	const store = transaction.objectStore(SNAPSHOT_STORE);
	const record = (await requestToPromise(store.get(scope))) as SnapshotRecord | undefined;
	await transactionDone(transaction);
	return record ? snapshotToReady(record.snapshot) : undefined;
}

export async function saveChannelMessages(
	scope: string,
	channelId: string,
	messages: messagejson[],
	allTheWayUp: boolean,
): Promise<void> {
	const db = await getDb();
	const transaction = db.transaction([MESSAGE_STORE, CHANNEL_STATE_STORE], "readwrite");
	const messageStore = transaction.objectStore(MESSAGE_STORE);
	const stateStore = transaction.objectStore(CHANNEL_STATE_STORE);
	const existingKeys = await getMessageKeysForChannel(messageStore, scope, channelId);
	for (const key of existingKeys) {
		messageStore.delete(key);
	}

	const trimmed = sortMessagesNewestFirst(messages).slice(0, MESSAGE_LIMIT);
	for (const message of trimmed) {
		const record: MessageRecord = {
			id: `${scope}::${channelId}::${message.id}`,
			scope,
			scopeChannel: makeChannelKey(scope, channelId),
			channelId,
			messageId: message.id,
			sortKey: message.id,
			message,
		};
		messageStore.put(record);
	}
	stateStore.put({
		id: makeChannelKey(scope, channelId),
		scope,
		channelId,
		allTheWayUp,
		updatedAt: Date.now(),
	} satisfies ChannelStateRecord);
	await transactionDone(transaction);
}

export async function getChannelMessages(
	scope: string,
	channelId: string,
): Promise<CachedChannelMessages> {
	const db = await getDb();
	const transaction = db.transaction([MESSAGE_STORE, CHANNEL_STATE_STORE], "readonly");
	const messageStore = transaction.objectStore(MESSAGE_STORE);
	const stateStore = transaction.objectStore(CHANNEL_STATE_STORE);
	const index = messageStore.index("byScopeChannel");
	const records = (await requestToPromise(
		index.getAll(IDBKeyRange.only(makeChannelKey(scope, channelId))),
	)) as MessageRecord[];
	const state = (await requestToPromise(
		stateStore.get(makeChannelKey(scope, channelId)),
	)) as ChannelStateRecord | undefined;
	await transactionDone(transaction);
	return {
		messages: records
			.map((record) => record.message)
			.sort((a, b) => {
				try {
					if (a.id === b.id) return 0;
					return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
				} catch {
					if (a.id === b.id) return 0;
					return b.id.localeCompare(a.id);
				}
			}),
		allTheWayUp: state?.allTheWayUp || false,
	};
}

export async function upsertCachedMessage(
	scope: string,
	channelId: string,
	message: messagejson,
): Promise<void> {
	const db = await getDb();
	const transaction = db.transaction(MESSAGE_STORE, "readwrite");
	const store = transaction.objectStore(MESSAGE_STORE);
	const channelKey = makeChannelKey(scope, channelId);
	store.put({
		id: `${scope}::${channelId}::${message.id}`,
		scope,
		scopeChannel: channelKey,
		channelId,
		messageId: message.id,
		sortKey: message.id,
		message,
	} satisfies MessageRecord);

	const index = store.index("byScopeChannel");
	const records = (await requestToPromise(index.getAll(IDBKeyRange.only(channelKey)))) as MessageRecord[];
	const overflow = records
		.sort((a, b) => {
			try {
				if (a.messageId === b.messageId) return 0;
				return BigInt(b.messageId) > BigInt(a.messageId) ? 1 : -1;
			} catch {
				if (a.messageId === b.messageId) return 0;
				return b.messageId.localeCompare(a.messageId);
			}
		})
		.slice(MESSAGE_LIMIT);
	for (const record of overflow) {
		store.delete(record.id);
	}
	await transactionDone(transaction);
}

export async function deleteCachedMessage(
	scope: string,
	channelId: string,
	messageId: string,
): Promise<void> {
	const db = await getDb();
	const transaction = db.transaction(MESSAGE_STORE, "readwrite");
	transaction.objectStore(MESSAGE_STORE).delete(`${scope}::${channelId}::${messageId}`);
	await transactionDone(transaction);
}
