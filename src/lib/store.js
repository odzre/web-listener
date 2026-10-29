const { Redis } = require('@upstash/redis');
const config = require('./config');

class MemoryStore {
  constructor() {
    this.values = new Map();
    this.expiries = new Map();
    this.sets = new Map();
    this.sorted = new Map();
  }

  now() {
    return Date.now();
  }

  purge(key) {
    const expiresAt = this.expiries.get(key);
    if (expiresAt && expiresAt <= this.now()) {
      this.values.delete(key);
      this.expiries.delete(key);
    }
  }

  async get(key) {
    this.purge(key);
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async set(key, value, options = {}) {
    this.purge(key);
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, String(value));
    if (options.ex) this.expiries.set(key, this.now() + options.ex * 1000);
    else this.expiries.delete(key);
    return 'OK';
  }

  async del(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this.values.delete(key)) count += 1;
      this.expiries.delete(key);
      if (this.sets.delete(key)) count += 1;
      if (this.sorted.delete(key)) count += 1;
    }
    return count;
  }

  async incr(key) {
    const value = Number(await this.get(key) || 0) + 1;
    await this.set(key, value);
    return value;
  }

  async expire(key, seconds) {
    if (!this.values.has(key) && !this.sets.has(key) && !this.sorted.has(key)) return 0;
    this.expiries.set(key, this.now() + seconds * 1000);
    return 1;
  }

  async mget(...keys) {
    return (await Promise.all(keys.flat().map((key) => this.get(key))));
  }

  async sadd(key, ...members) {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members.flat()) {
      if (!set.has(String(member))) {
        set.add(String(member));
        added += 1;
      }
    }
    return added;
  }

  async srem(key, ...members) {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members.flat()) {
      if (set.delete(String(member))) removed += 1;
    }
    return removed;
  }

  async smembers(key) {
    return Array.from(this.sets.get(key) || []);
  }

  async sismember(key, member) {
    return (this.sets.get(key) || new Set()).has(String(member)) ? 1 : 0;
  }

  async zadd(key, score, member) {
    let zset = this.sorted.get(key);
    if (!zset) {
      zset = new Map();
      this.sorted.set(key, zset);
    }
    const isNew = !zset.has(String(member));
    zset.set(String(member), Number(score));
    return isNew ? 1 : 0;
  }

  async zrem(key, member) {
    const zset = this.sorted.get(key);
    if (!zset) return 0;
    return zset.delete(String(member)) ? 1 : 0;
  }

  async zcard(key) {
    return (this.sorted.get(key) || new Map()).size;
  }

  async zrange(key, start, stop, options = {}) {
    const zset = this.sorted.get(key) || new Map();
    let entries = Array.from(zset.entries()).sort((a, b) => {
      if (a[1] === b[1]) return a[0].localeCompare(b[0]);
      return a[1] - b[1];
    });
    if (options.rev) entries = entries.reverse();
    let sliced;
    if (stop === -1) sliced = entries.slice(start);
    else sliced = entries.slice(start, stop + 1);
    return sliced.map((entry) => entry[0]);
  }

  async zrangeByScore(key, min, max, options = {}) {
    const zset = this.sorted.get(key) || new Map();
    let entries = Array.from(zset.entries())
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1]);
    if (options.limit) entries = entries.slice(0, options.limit);
    return entries.map((entry) => entry[0]);
  }

  async zscore(key, member) {
    const value = (this.sorted.get(key) || new Map()).get(String(member));
    return value === undefined ? null : value;
  }
}

class UpstashStore {
  constructor(url, token) {
    this.client = new Redis({
      url,
      token,
      automaticDeserialization: false,
    });
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, options = {}) {
    const opts = {};
    if (options.ex) opts.ex = options.ex;
    if (options.nx) opts.nx = true;
    return this.client.set(key, String(value), opts);
  }

  async del(...keys) {
    return this.client.del(...keys.flat());
  }

  async incr(key) {
    return this.client.incr(key);
  }

  async expire(key, seconds) {
    return this.client.expire(key, seconds);
  }

  async mget(...keys) {
    return this.client.mget(...keys.flat());
  }

  async sadd(key, ...members) {
    return this.client.sadd(key, ...members.flat());
  }

  async srem(key, ...members) {
    return this.client.srem(key, ...members.flat());
  }

  async smembers(key) {
    return this.client.smembers(key);
  }

  async sismember(key, member) {
    return this.client.sismember(key, String(member));
  }

  async zadd(key, score, member) {
    return this.client.zadd(key, { score: Number(score), member: String(member) });
  }

  async zrem(key, member) {
    return this.client.zrem(key, String(member));
  }

  async zcard(key) {
    return this.client.zcard(key);
  }

  async zrange(key, start, stop, options = {}) {
    const opts = {};
    if (options.rev) opts.rev = true;
    return this.client.zrange(key, start, stop, opts);
  }

  async zrangeByScore(key, min, max, options = {}) {
    const opts = { byScore: true };
    if (options.limit) {
      opts.offset = 0;
      opts.count = options.limit;
    }
    return this.client.zrange(key, min, max, opts);
  }

  async zscore(key, member) {
    return this.client.zscore(key, String(member));
  }
}

const useUpstash = Boolean(config.upstashUrl && config.upstashToken);
const store = useUpstash
  ? new UpstashStore(config.upstashUrl, config.upstashToken)
  : new MemoryStore();

module.exports = {
  store,
  useUpstash,
  MemoryStore,
};
