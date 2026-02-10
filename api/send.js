import { Redis } from '@upstash/redis';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res) {
  Object.entries(cors).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

function ok(res, body, status = 200) {
  setCors(res);
  return res.status(status).json(body);
}

function err(res, message, status = 400) {
  setCors(res);
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);

  // Check env vars before creating Redis client
  // Support both Upstash Redis and Vercel KV naming conventions
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) {
    return err(res, 'Storage not configured. Add Upstash Redis to this Vercel project and ensure UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/KV_REST_API_TOKEN) are set.', 503);
  }

  let redis;
  try {
    redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
  } catch (e) {
    console.error('Redis client creation error:', e);
    return err(res, 'Failed to initialize storage client.', 503);
  }

  const { workspace, json } = req.body || {};
  const ws = typeof workspace === 'string' ? workspace.trim() : '';
  if (!ws) return err(res, 'workspace is required');
  if (ws.length > 64) return err(res, 'workspace too long');
  if (typeof json !== 'string') return err(res, 'json (string) is required');

  const sentAt = Date.now();
  const key = `audience:payloads:${ws}`;
  const MAX_PAYLOADS = 100;

  try {
    const raw = await redis.get(key);
    const list = raw != null ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    if (!Array.isArray(list)) list = [];
    list.push({ json, sentAt });
    const trimmed = list.slice(-MAX_PAYLOADS);
    await redis.set(key, JSON.stringify(trimmed));
    return ok(res, { ok: true });
  } catch (e) {
    console.error('Redis set error:', e);
    return err(res, 'Storage error: ' + (e.message || 'Unknown error'), 503);
  }
}
