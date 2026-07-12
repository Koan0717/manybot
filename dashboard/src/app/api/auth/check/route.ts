import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

export async function GET() {
  const payload = await isAuthenticated();
  return NextResponse.json({ 
    authenticated: !!payload,
    user: payload
  });
}
