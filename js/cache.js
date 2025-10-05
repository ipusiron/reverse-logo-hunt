const DB_NAME = 'reverse-logo-hunt-cache';
const DB_VERSION = 1;
const STORES = ['wikidata', 'relations', 'commons'];

let dbPromise = null;

function hasIndexedDB(){
  return typeof indexedDB !== 'undefined';
}

function openDB(){
  if(!hasIndexedDB()) return Promise.reject(new Error('IndexedDB not supported'));
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      STORES.forEach(store => {
        if(!db.objectStoreNames.contains(store)){
          db.createObjectStore(store, { keyPath: 'key' });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function runTransaction(storeName, mode, handler){
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = handler(store);
      tx.oncomplete = () => resolve(request?.result ?? null);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[CACHE] Transaction failed', err);
    return null;
  }
}

export async function getCached(storeName, key){
  if(!hasIndexedDB()) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = async () => {
        const record = req.result;
        if(!record){
          resolve(null);
          return;
        }
        if(record.expiresAt && record.expiresAt < Date.now()){
          try {
            await runTransaction(storeName, 'readwrite', s => s.delete(key));
          } catch (err) {
            console.warn('[CACHE] Failed to purge expired entry', err);
          }
          resolve(null);
          return;
        }
        resolve(record.value);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[CACHE] getCached failed', err);
    return null;
  }
}

export async function setCached(storeName, key, value, ttlMs){
  if(!hasIndexedDB()) return false;
  const record = {
    key,
    value,
    expiresAt: typeof ttlMs === 'number' ? Date.now() + ttlMs : null
  };
  const res = await runTransaction(storeName, 'readwrite', (store) => store.put(record));
  return !!res || res === undefined;
}

export async function clearExpired(storeName){
  if(!hasIndexedDB()) return;
  await runTransaction(storeName, 'readwrite', (store) => {
    const now = Date.now();
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if(!cursor) return;
      if(cursor.value?.expiresAt && cursor.value.expiresAt < now){
        cursor.delete();
      }
      cursor.continue();
    };
    return request;
  });
}
