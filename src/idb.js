// 最小 IndexedDB kv(无依赖):handles 存目录句柄(不可 JSON 序列化),pairs 存按对绑定的状态
function db() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('img-hover-reveal', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('handles'))
        d.createObjectStore('handles');
      if (!d.objectStoreNames.contains('pairs'))
        d.createObjectStore('pairs');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function idbSet(store, key, val) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

export async function idbGet(store, key) {
  const d = await db();
  return new Promise((res, rej) => {
    const rq = d.transaction(store).objectStore(store).get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
