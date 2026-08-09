import { NextResponse } from 'next/server'
import {
  analyzeVisualCandidate,
  listLegacyDefinitions,
  stageVisualCandidate,
} from '../../../mfd-stadium-studio/src/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ legacy: await listLegacyDefinitions() })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; visual?: unknown }
    if (body.action === 'analyze') return NextResponse.json(await analyzeVisualCandidate(body.visual))
    if (body.action === 'stage') return NextResponse.json(await stageVisualCandidate(body.visual))
    return NextResponse.json({ error: `Unsupported studio action: ${String(body.action)}` }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
