import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/pricing`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-API-Key': ADMIN_API_KEY,
      },
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Pricing API] Error:', error);
    return NextResponse.json({ success: false, data: [], count: 0 }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Reload cache endpoint
  try {
    const response = await fetch(`${BACKEND_URL}/api/admin/pricing/reload-cache`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-API-Key': ADMIN_API_KEY,
      },
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Pricing API] Reload error:', error);
    return NextResponse.json({ success: false, error: 'Failed to reload cache' }, { status: 500 });
  }
}
