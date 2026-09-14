import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/extension/")) return NextResponse.next();
  const origin = request.headers.get("origin");
  const expectedOrigin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-origin access is not allowed. Extensions must use the paired gateway." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };