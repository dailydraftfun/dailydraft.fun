import { createPublicSurfaceReceipt } from '../../../../public-duel-receipt';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ duelId: string }> },
): Promise<Response> {
  if (process.env.NEXT_PUBLIC_E2E_FIXTURES !== '1') {
    return new Response(null, { status: 404 });
  }

  const { duelId } = await params;
  const receipt = createPublicSurfaceReceipt(duelId);
  if (!receipt) return new Response(null, { status: 404 });

  return Response.json(receipt, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
