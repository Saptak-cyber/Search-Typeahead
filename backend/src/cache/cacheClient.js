import Redis from 'ioredis';
import { config } from '../config.js';
import { HashRing } from './hashRing.js';
import { metrics } from '../metrics/metrics.js';

// Distributed suggestion cache spread over multiple real Redis instances.
// Which node owns a given prefix key is decided by consistent hashing.
class CacheClient {
  constructor() {
    this.clients = new Map(); // nodeId -> ioredis client
    this.ring = new HashRing(
      config.redisNodes.map((n) => n.id),
      config.ringReplicas
    );
    for (const node of config.redisNodes) {
      this.clients.set(
        node.id,
        new Redis({ host: node.host, port: node.port, lazyConnect: false, maxRetriesPerRequest: 2 })
      );
    }
  }

  keyFor(prefix, mode) {
    return `suggest:${mode}:${prefix}`;
  }

  // Returns the ioredis client responsible for `key` (consistent hashing).
  clientFor(key) {
    const node = this.ring.getNode(key);
    return { node, client: this.clients.get(node) };
  }

  // Routing introspection for GET /cache/debug.
  async debug(prefix, mode = 'basic') {
    const key = this.keyFor(prefix, mode);
    const { node, ringPosition, keyHash } = this.ring.locate(key);
    const client = this.clients.get(node);
    const exists = client ? (await client.exists(key)) === 1 : false;
    return {
      prefix,
      mode,
      key,
      node,
      keyHash,
      ringPosition,
      ttlSeconds: exists && client ? await client.ttl(key) : null,
      status: exists ? 'hit' : 'miss',
    };
  }

  async get(prefix, mode) {
    const key = this.keyFor(prefix, mode);
    const { client } = this.clientFor(key);
    if (!client) return null;
    const raw = await client.get(key);
    if (raw == null) {
      metrics.inc('cacheMiss');
      return null;
    }
    metrics.inc('cacheHit');
    return JSON.parse(raw);
  }

  async set(prefix, mode, suggestions, ttlSeconds) {
    const key = this.keyFor(prefix, mode);
    const { client } = this.clientFor(key);
    if (!client) return;
    await client.set(key, JSON.stringify(suggestions), 'EX', ttlSeconds);
  }

  // Invalidate every prefix key derived from a query (i, ip, iph, ...) in both modes.
  // Keys for different prefixes may live on different nodes, so route each one.
  async invalidateForQuery(query) {
    const pipelines = new Map(); // nodeId -> pipeline
    for (let i = 1; i <= query.length; i++) {
      const prefix = query.slice(0, i);
      for (const mode of ['basic', 'recency']) {
        const key = this.keyFor(prefix, mode);
        const { node, client } = this.clientFor(key);
        if (!client) continue;
        if (!pipelines.has(node)) pipelines.set(node, client.pipeline());
        pipelines.get(node).del(key);
      }
    }
    await Promise.all([...pipelines.values()].map((p) => p.exec()));
  }

  async quit() {
    await Promise.all([...this.clients.values()].map((c) => c.quit().catch(() => {})));
  }
}

export const cacheClient = new CacheClient();
