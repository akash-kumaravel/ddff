export type WebProject = {
	id: string;
	name: string;
	createdAt: number;
	duration: number;
	mimeType: string;
	blob: Blob;
};

const DATABASE_NAME = "recordly-web-library";
const STORE_NAME = "projects";

function openLibrary(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, 1);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Could not open the video library."));
	});
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
	const database = await openLibrary();
	return new Promise<T>((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, mode);
		const request = action(transaction.objectStore(STORE_NAME));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Could not update the video library."));
		transaction.oncomplete = () => database.close();
		transaction.onerror = () => {
			database.close();
			reject(transaction.error ?? new Error("Could not update the video library."));
		};
	});
}

export function saveProject(project: WebProject) {
	return withStore<IDBValidKey>("readwrite", (store) => store.put(project));
}

export function listProjects() {
	return withStore<WebProject[]>("readonly", (store) => store.getAll());
}

export function deleteProject(id: string) {
	return withStore<undefined>("readwrite", (store) => store.delete(id));
}