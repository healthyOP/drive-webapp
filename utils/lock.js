// One Node process owns this deployment. Do not use cluster/PM2 replicas.
export function createLock() {
  const queues = new Map();
  return async function withLock(key, action) {
    const previous = queues.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    queues.set(key, current);
    await previous;
    try { return await action(); }
    finally { release(); if (queues.get(key) === current) queues.delete(key); }
  };
}
