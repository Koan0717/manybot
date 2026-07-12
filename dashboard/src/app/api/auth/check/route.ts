import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

export async function GET() {
  const authenticated = isAuthenticated();
  return NextResponse.json({ authenticated });
}
