// Keep the original database name so existing libraries remain accessible.
const DB_NAME = "stillroom";
const STORE = "library";
const KEY = "current";
const PLAYLIST_PREFIX = "playlist:";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The library database is blocked by another tab."));
  });
}

async function transaction(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("The library database transaction was aborted."));
    });
  } finally {
    db.close();
  }
}

export function loadLibrary() {
  return transaction("readonly", store => store.get(KEY));
}

export function saveLibrary(library) {
  return transaction("readwrite", store => store.put(library, KEY));
}

export function loadSavedPlaylists() {
  return transaction("readonly", store => store.getAll(IDBKeyRange.bound(PLAYLIST_PREFIX, `${PLAYLIST_PREFIX}\uffff`)));
}

export function saveSavedPlaylist(playlist) {
  return transaction("readwrite", store => store.put(playlist, `${PLAYLIST_PREFIX}${playlist.id}`));
}

export function deleteSavedPlaylist(id) {
  return transaction("readwrite", store => store.delete(`${PLAYLIST_PREFIX}${id}`));
}
