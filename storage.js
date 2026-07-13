// Tiny promise-based key/value wrapper over IndexedDB. Everything the app
// persists (settings, crop sources, traces, glyph PNGs, reference-image Blob
// records and the active image ID) lives in one object store.
export const ProjectStore = (() => {
  const DB_NAME = "img2openscad-glyph-editor";
  const STORE = "kv";
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function get(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function set(key, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Write several keys (and optionally delete others) in ONE transaction, so
  // a quota failure or interruption cannot leave a half-written project.
  async function setMany(values, removeKeys = []) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [key, value] of Object.entries(values)) store.put(value, key);
      for (const key of removeKeys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function remove(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { get, set, setMany, remove };
})();
