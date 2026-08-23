import { createClient } from "redis";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  sAdd(key: string, member: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
  sRem(key: string, member: string): Promise<unknown>;
  lPush(key: string, element: string): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lTrim(key: string, start: number, stop: number): Promise<unknown>;
  lRem(key: string, count: number, element: string): Promise<unknown>;
}

let defaultClient: RedisLike | null = null;
let connecting: Promise<RedisLike> | null = null;

/** Lazily connects a single shared Redis client, reused across session and escalation tracking. */
export function getRedisClient(): Promise<RedisLike> {
  if (defaultClient) return Promise.resolve(defaultClient);
  if (!connecting) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    connecting = createClient({ url })
      .connect()
      .then((client) => {
        defaultClient = client as unknown as RedisLike;
        return defaultClient;
      });
  }
  return connecting;
}
