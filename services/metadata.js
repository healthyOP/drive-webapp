// Reserve bounded database work before sending it, even for failed/empty queries.
export function createMetadata(db, reserve) {
  const items = db.collection('items');
  const unpack = doc => doc.exists ? { ...doc.data(), id: doc.id } : null;
  return {
    async get(id) { await reserve({ reads: 1 }); return unpack(await items.doc(id).get()); },
    async list({ ownerId, parentId, sharedUid, after, limit = 51 }) {
      await reserve({ reads: limit });
      let query = sharedUid
        ? items.where('sharedWith', 'array-contains', sharedUid)
        : items.where('ownerId', '==', ownerId).where('parentId', '==', parentId);
      query = query.orderBy('__name__');
      if (after) query = query.startAfter(items.doc(after));
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map(unpack);
    },
    async commit({ puts = [], deletes = [] }) {
      await reserve({ writes: puts.length, deletes: deletes.length });
      const batch = db.batch();
      for (const item of puts) { const { id, ...data } = item; batch.set(items.doc(id), data); }
      for (const id of deletes) batch.delete(items.doc(id));
      await batch.commit();
    }
  };
}
