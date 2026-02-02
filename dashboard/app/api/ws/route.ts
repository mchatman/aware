import { NextResponse } from "next/server";

/**
 * WebSocket endpoint — NOT natively supported in Next.js App Router.
 *
 * Next.js route handlers run as serverless/edge functions and cannot maintain
 * persistent WebSocket connections. To add real WebSocket support, you would need:
 *
 * Option 1: Custom Next.js server (pages/api with custom server.ts)
 *   - Use `ws` package with a custom HTTP server
 *   - Breaks Vercel deployment (requires Node.js server)
 *
 * Option 2: Separate WebSocket service
 *   - Run a standalone WS server (e.g., with Hono, Fastify, or raw ws)
 *   - Deploy alongside the Next.js app
 *   - Best for production: separate scaling, no coupling
 *
 * Option 3: Third-party real-time service
 *   - Pusher, Ably, Liveblocks, Supabase Realtime, etc.
 *   - Managed solution, less infrastructure to maintain
 *
 * For MVP:
 *   The Mac app should use POST /api/chat with SSE (Server-Sent Events) streaming.
 *   SSE works over regular HTTP and is fully supported by Next.js route handlers.
 *   The /api/chat endpoint already returns a streaming SSE response.
 *
 * SSE usage from the Mac app (Swift):
 *   ```swift
 *   let url = URL(string: "https://your-app.com/api/chat")!
 *   var request = URLRequest(url: url)
 *   request.httpMethod = "POST"
 *   request.setValue("application/json", forHTTPHeaderField: "Content-Type")
 *   request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
 *   request.httpBody = try JSONEncoder().encode(["message": text, "orgId": orgId])
 *
 *   let (stream, response) = try await URLSession.shared.bytes(for: request)
 *   for try await line in stream.lines {
 *       if line.hasPrefix("data: ") {
 *           let data = String(line.dropFirst(6))
 *           // Process SSE event
 *       }
 *   }
 *   ```
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "WebSocket not supported",
      message:
        "Next.js App Router does not support WebSocket connections. Use POST /api/chat with SSE streaming instead.",
      documentation: {
        sseEndpoint: "POST /api/chat",
        body: { message: "string", orgId: "string" },
        responseType: "text/event-stream",
      },
    },
    { status: 501 },
  );
}
