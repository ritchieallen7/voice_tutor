import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // For now, return the API key directly (in production, use ephemeral tokens)
    // OpenAI Realtime API currently uses direct API key authentication
    return NextResponse.json({
      client_secret: apiKey,
    });
  } catch (error) {
    console.error('Realtime API error:', error);
    return NextResponse.json(
      { error: 'Failed to create realtime session' },
      { status: 500 }
    );
  }
}