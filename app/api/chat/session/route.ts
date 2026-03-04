/**
 * DELETE /api/chat/session
 * 
 * Proxy to FastAPI backend to clear expired session memory.
 * Called by widget frontend when session TTL (24h) expires.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const { sessionId, companyId } = body;

        if (!sessionId || !companyId) {
            return NextResponse.json(
                { error: 'sessionId and companyId are required' },
                { status: 400 }
            );
        }

        // Proxy to FastAPI backend
        const response = await fetch(`${BACKEND_URL}/chat/session`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId, companyId }),
        });

        const data = await response.json();

        return NextResponse.json(data, { status: response.status });

    } catch (error) {
        console.error('[API] Error deleting session:', error);
        return NextResponse.json(
            { error: 'Failed to delete session' },
            { status: 500 }
        );
    }
}
