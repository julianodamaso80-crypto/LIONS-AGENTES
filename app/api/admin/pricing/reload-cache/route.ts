import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

export async function POST() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/pricing/reload-cache`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-API-Key': ADMIN_API_KEY,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Pricing API] Reload cache error:', error);
    return NextResponse.json({ success: false, error: 'Failed to reload cache' }, { status: 500 });
  }
}
