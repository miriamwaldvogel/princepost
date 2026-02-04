import { Redis } from '@upstash/redis';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res) {
  Object.entries(cors).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    setCors(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workspace = typeof req.query?.workspace === 'string' ? req.query.workspace.trim() : '';
  if (!workspace) {
    setCors(res);
    return res.status(400).json({ error: 'workspace query is required' });
  }

  // Check env vars before creating Redis client
  // Support both Upstash Redis and Vercel KV naming conventions
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) {
    setCors(res);
    return res.status(503).json({
      error: 'Storage not configured. Add Upstash Redis to this Vercel project and ensure UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/KV_REST_API_TOKEN) are set.',
    });
  }

  let redis;
  try {
    redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
  } catch (e) {
    console.error('Redis client creation error:', e);
    setCors(res);
    return res.status(503).json({ error: 'Failed to initialize storage client.' });
  }

  const key = `audience:payload:${workspace}`;
  try {
    const raw = await redis.get(key);
    if (raw == null) {
      setCors(res);
      return res.status(404).json({ json: null, sentAt: null });
    }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const json = data?.json ?? null;
    const sentAt = data?.sentAt ?? null;
    setCors(res);
    return res.status(200).json({ json, sentAt });
  } catch (e) {
    console.error('Redis get error:', e);
    setCors(res);
    return res.status(503).json({ error: 'Storage error: ' + (e.message || 'Unknown error') });
  }
}
