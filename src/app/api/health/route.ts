import { readiness } from "../../../server/operations";
export const dynamic = "force-dynamic";
export async function GET() {
  const state = await readiness(new Date());
  return Response.json(state, {
    status: state.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
