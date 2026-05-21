/**
 * Shared Bun HTTP + WebSocket server for all Twilio-based channels
 * (voice, SMS, WhatsApp). Channels register routes during their start();
 * the server lazily binds the port on first start() and stays bound until
 * stop() is called. Idempotent in both directions.
 *
 * Cross-cutting features applied per route:
 *   - X-Twilio-Signature HMAC-SHA1 validation (default on for /twilio/*).
 *   - Dedup based on a configurable form field (e.g. MessageSid, CallSid).
 *   - Per-key rate limit (e.g. From), to bound cost when a stranger
 *     guesses the shared WhatsApp Sandbox join code.
 *
 * Channels keep their domain logic; the server keeps the wiring.
 */
import type { Server, ServerWebSocket } from "bun";
import { log } from "../../utils/log";
import { validateTwilioSignature } from "./signature";
import { Dedup } from "./dedup";
import { RateLimiter } from "./rate-limit";
import { cacheMedia, readCachedMedia } from "./media-cache";

export interface TwilioRequestContext {
  /** Form-decoded body. */
  params: Record<string, string>;
}

export type HttpHandler = (req: Request, ctx: TwilioRequestContext) => Promise<Response> | Response;

export interface HttpRouteOpts {
  /** Validate X-Twilio-Signature. Defaults to true. Set false for /healthz etc. */
  verifySignature?: boolean;
  /** If set, dedup based on this form field. Repeated values within the dedup window 204 silently. */
  dedupOn?: string;
  /** If set, rate-limit based on this form field. Over-limit 429s. */
  rateLimitOn?: string;
}

export interface WsConnectionData {
  path: string;
  channel: Record<string, unknown>;
}

export interface WsRoute {
  /** Called when a frame arrives. */
  onMessage(ws: ServerWebSocket<WsConnectionData>, data: string): void;
  /** Called when the connection closes. Optional. */
  onClose?(ws: ServerWebSocket<WsConnectionData>): void;
}

export interface ServerConfig {
  port: number;
  /** Public base URL the server is reachable at (e.g. https://nia.example.com). No trailing slash. */
  publicBaseUrl: string | null;
  /** Account Auth Token used to verify X-Twilio-Signature. */
  signingToken: string | null;
}

export interface TwilioServer {
  configure(cfg: ServerConfig): void;
  registerHttp(path: string, handler: HttpHandler, opts?: HttpRouteOpts): void;
  registerWs(path: string, route: WsRoute): void;
  /** Mark a key as exempt from rate-limiting (e.g. the owner's number). */
  exemptFromRateLimit(key: string): void;
  start(): Promise<void>;
  stop(): void;
  /** Build the WSS URL for a registered path, using publicBaseUrl. */
  buildWssUrl(path: string): string;
  /** Build the HTTPS URL for a registered path, using publicBaseUrl. */
  buildHttpUrl(path: string): string;
  /**
   * Write a media payload to the on-disk outbound cache and return its
   * publicly-reachable URL. Twilio fetches the URL when delivering MMS /
   * WhatsApp media. Requires publicBaseUrl to be configured.
   */
  serveMedia(buffer: Uint8Array, mime: string, ext?: string): Promise<string>;
}

class TwilioServerImpl implements TwilioServer {
  private cfg: ServerConfig | null = null;
  private bunServer: Server<WsConnectionData> | null = null;
  private readonly httpRoutes = new Map<string, { handler: HttpHandler; opts: HttpRouteOpts }>();
  private readonly wsRoutes = new Map<string, WsRoute>();
  private readonly dedup = new Dedup();
  private readonly rateLimit = new RateLimiter();
  private readonly rateLimitExempt = new Set<string>();

  configure(cfg: ServerConfig): void {
    this.cfg = cfg;
  }

  registerHttp(path: string, handler: HttpHandler, opts: HttpRouteOpts = {}): void {
    if (this.httpRoutes.has(path)) {
      log.warn({ path }, "twilio-server: overwriting existing HTTP route");
    }
    this.httpRoutes.set(path, { handler, opts });
  }

  registerWs(path: string, route: WsRoute): void {
    if (this.wsRoutes.has(path)) {
      log.warn({ path }, "twilio-server: overwriting existing WS route");
    }
    this.wsRoutes.set(path, route);
  }

  exemptFromRateLimit(key: string): void {
    this.rateLimitExempt.add(key);
    this.rateLimit.exempt(key);
  }

  async start(): Promise<void> {
    if (this.bunServer) return;
    if (!this.cfg) throw new Error("twilio-server: configure() must be called before start()");
    const cfg = this.cfg;
    const self = this;

    this.bunServer = Bun.serve<WsConnectionData, never>({
      port: cfg.port,
      async fetch(req, server) {
        const path = new URL(req.url).pathname;

        if (path === "/healthz") return new Response("ok", { status: 200 });
        if (path === "/twilio/health") return new Response("ok", { status: 200 });

        if (req.method === "GET" && path.startsWith("/twilio/media/")) {
          return await self.handleMedia(path.slice("/twilio/media/".length));
        }

        const wsRoute = self.wsRoutes.get(path);
        if (wsRoute) {
          const ok = server.upgrade(req, { data: { path, channel: {} } });
          return ok ? undefined : new Response("expected websocket", { status: 400 });
        }

        const httpRoute = self.httpRoutes.get(path);
        if (!httpRoute) return new Response("not found", { status: 404 });

        return await self.handleHttp(req, httpRoute);
      },
      websocket: {
        message(ws, message) {
          const route = self.wsRoutes.get(ws.data.path);
          if (!route) {
            try {
              ws.close();
            } catch {}
            return;
          }
          const data = typeof message === "string" ? message : new TextDecoder().decode(message);
          route.onMessage(ws, data);
        },
        close(ws) {
          const route = self.wsRoutes.get(ws.data.path);
          route?.onClose?.(ws);
        },
      },
    });

    log.info({ port: cfg.port, publicBaseUrl: cfg.publicBaseUrl }, "twilio-server: started");
  }

  stop(): void {
    if (!this.bunServer) return;
    this.bunServer.stop(true);
    this.bunServer = null;
    log.info("twilio-server: stopped");
  }

  buildWssUrl(path: string): string {
    if (!this.cfg?.publicBaseUrl) throw new Error("twilio-server: publicBaseUrl not configured");
    return this.cfg.publicBaseUrl.replace(/^http/, "ws") + path;
  }

  buildHttpUrl(path: string): string {
    if (!this.cfg?.publicBaseUrl) throw new Error("twilio-server: publicBaseUrl not configured");
    return this.cfg.publicBaseUrl + path;
  }

  async serveMedia(buffer: Uint8Array, mime: string, ext?: string): Promise<string> {
    if (!this.cfg?.publicBaseUrl) {
      throw new Error("twilio-server: serveMedia requires channels.twilio.public_base_url to be configured");
    }
    const { filename } = await cacheMedia(buffer, mime, ext);
    return `${this.cfg.publicBaseUrl}/twilio/media/${filename}`;
  }

  private async handleMedia(filename: string): Promise<Response> {
    const hit = await readCachedMedia(filename);
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(hit.buffer), {
      status: 200,
      headers: {
        "Content-Type": hit.mime,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  private async handleHttp(req: Request, route: { handler: HttpHandler; opts: HttpRouteOpts }): Promise<Response> {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const params = await this.readForm(req);

    if (route.opts.verifySignature !== false) {
      if (!this.verifySignature(req, params)) {
        log.warn({ path: new URL(req.url).pathname }, "twilio-server: signature check failed");
        return new Response("invalid signature", { status: 403 });
      }
    }

    if (route.opts.rateLimitOn) {
      const key = params[route.opts.rateLimitOn];
      if (key && !this.rateLimitExempt.has(key) && !this.rateLimit.allow(key)) {
        log.warn({ key, field: route.opts.rateLimitOn }, "twilio-server: rate limit exceeded");
        return new Response("too many requests", { status: 429 });
      }
    }

    if (route.opts.dedupOn) {
      const id = params[route.opts.dedupOn];
      if (id && this.dedup.check(id)) {
        log.debug({ id, field: route.opts.dedupOn }, "twilio-server: duplicate webhook dropped");
        return new Response("", { status: 204 });
      }
    }

    return await route.handler(req, { params });
  }

  private async readForm(req: Request): Promise<Record<string, string>> {
    const body = await req.text();
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(body)) params[k] = v;
    return params;
  }

  private verifySignature(req: Request, params: Record<string, string>): boolean {
    const token = this.cfg?.signingToken;
    if (!token) return false;
    const signature = req.headers.get("X-Twilio-Signature") || "";
    const fullUrl = this.cfg?.publicBaseUrl ? `${this.cfg.publicBaseUrl}${new URL(req.url).pathname}` : req.url;
    return validateTwilioSignature({ authToken: token, fullUrl, params, signature });
  }
}

let _instance: TwilioServer | null = null;

export function getTwilioServer(): TwilioServer {
  if (!_instance) _instance = new TwilioServerImpl();
  return _instance;
}

/** Test-only: drop the singleton so tests get a fresh server. */
export function resetTwilioServer(): void {
  _instance = null;
}
