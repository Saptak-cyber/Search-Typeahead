import crypto from 'node:crypto';

// Consistent-hash ring with virtual nodes.
//
// Each physical node is placed at `replicas` positions on a 32-bit ring. A key is
// hashed to a point on the ring and owned by the first node clockwise from it.
// This keeps key->node assignment stable when nodes are added/removed: only keys
// in the arc(s) around the changed node move, not the whole keyspace.
export class HashRing {
  constructor(nodeIds = [], replicas = 150) {
    this.replicas = replicas;
    this.ring = []; // sorted array of { hash, node }
    this.nodes = new Set();
    for (const id of nodeIds) this.addNode(id);
  }

  static hash(str) {
    // First 8 hex chars of MD5 -> unsigned 32-bit int. Fast and well-distributed.
    const hex = crypto.createHash('md5').update(str).digest('hex').slice(0, 8);
    return parseInt(hex, 16) >>> 0;
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.add(nodeId);
    for (let i = 0; i < this.replicas; i++) {
      this.ring.push({ hash: HashRing.hash(`${nodeId}#${i}`), node: nodeId });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);
    this.ring = this.ring.filter((p) => p.node !== nodeId);
  }

  // Owning node for a key + the ring position used (for /cache/debug).
  locate(key) {
    if (this.ring.length === 0) return { node: null, ringPosition: null };
    const h = HashRing.hash(key);
    // Binary search for the first ring point with hash >= h; wrap to 0 otherwise.
    let lo = 0;
    let hi = this.ring.length - 1;
    if (h > this.ring[hi].hash) {
      return { node: this.ring[0].node, ringPosition: this.ring[0].hash, keyHash: h };
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].hash >= h) hi = mid;
      else lo = mid + 1;
    }
    return { node: this.ring[lo].node, ringPosition: this.ring[lo].hash, keyHash: h };
  }

  getNode(key) {
    return this.locate(key).node;
  }
}
