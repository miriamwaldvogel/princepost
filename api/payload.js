import { Redis } from '@upstash/redis';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).set(cors).end();
  if (req.method !== 'GET') {
    return res.status(405).set(cors).json({ error: 'Method not allowed' });
  }

  const workspace = typeof req.query?.workspace === 'string' ? req.query.workspace.trim() : '';
  if (!workspace) {
    return res.status(400).set(cors).json({ error: 'workspace query is required' });
  }

  let redis;
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    return res.status(503).set(cors).json({
      error: 'Storage not configured. Add Upstash Redis to this Vercel project.',
    });
  }

  const key = `audience:payload:${workspace}`;
  try {
    const raw = await redis.get(key);
    if (raw == null) {
      return res.status(404).set(cors).json({ json: null, sentAt: null });
    }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const json = data?.json ?? null;
    const sentAt = data?.sentAt ?? null;
    return res.status(200).set(cors).json({ json, sentAt });
  } catch (e) {
    console.error(e);
    return res.status(503).set(cors).json({ error: 'Storage error' });
  }
}
