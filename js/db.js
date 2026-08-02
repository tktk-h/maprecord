window.App = window.App || {};
App.db = (function () {
  const DB_NAME = 'date-recorder';
  const STORE = 'records';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }
  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function add(record)    { return wrap((await tx('readwrite')).add(record)); }
  async function put(record)    { return wrap((await tx('readwrite')).put(record)); }
  async function remove(id)     { return wrap((await tx('readwrite')).delete(id)); }
  async function getAll()       { return wrap((await tx('readonly')).getAll()); }
  async function clear()        { return wrap((await tx('readwrite')).clear()); }

  return { add, put, remove, getAll, clear };
})();
