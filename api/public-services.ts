import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_firebaseAdmin.js';

/**
 * GET /api/public-services?category=SEO
 * Returns published services filtered by category (no auth required).
 * Only exposes safe fields: id, title, description, price, currency, category.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = (req.query.category as string) || 'SEO';

  try {
    const snap = await adminDb
      .collection('services')
      .where('category', '==', category)
      .orderBy('price', 'asc')
      .get();

    const services = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || d.name || '',
        description: d.description || '',
        price: d.price ?? 0,
        currency: d.currency || 'ALL',
        category: d.category || '',
      };
    });

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ services });
  } catch (err: any) {
    console.error('public-services error:', err);
    return res.status(500).json({ error: 'Failed to fetch services' });
  }
}
