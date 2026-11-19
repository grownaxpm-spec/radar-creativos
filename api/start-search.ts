// Vercel Function: POST /api/start-search
import { startSearch } from "../server/startSearch.ts";

export async function POST(request: Request): Promise<Response> {
  return startSearch(request, process.env);
}
