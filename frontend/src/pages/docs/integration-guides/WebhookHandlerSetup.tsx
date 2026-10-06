import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const FASTAPI_HANDLER = `from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
import hmac, hashlib, time, json

app = FastAPI()
WEBHOOK_SECRET = "whsec_your_webhook_secret"

# Track processed event IDs to handle duplicates
processed_events: set[str] = set()

@app.post("/webhooks/lenis")
async def lenis_webhook(request: Request, background_tasks: BackgroundTasks):
    payload = await request.body()
    sig_header = request.headers.get("X-Lenis-Signature", "")

    # 1. Verify signature
    try:
        parts = dict(p.split("=", 1) for p in sig_header.split(","))
        ts, v1_sig = parts["t"], parts["v1"]
    except (ValueError, KeyError):
        raise HTTPException(400, "Missing signature")

    if abs(time.time() - int(ts)) > 300:
        raise HTTPException(400, "Timestamp out of tolerance")

    signed = f"{ts}.{payload.decode()}"
    expected = hmac.new(WEBHOOK_SECRET.encode(), signed.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1_sig):
        raise HTTPException(400, "Invalid signature")

    event = json.loads(payload)

    # 2. Deduplicate — Lenis may deliver the same event more than once
    event_id = event["id"]
    if event_id in processed_events:
        return {"received": True}  # Already handled
    processed_events.add(event_id)

    # 3. Respond immediately, process in background
    background_tasks.add_task(process_event, event)
    return {"received": True}

async def process_event(event: dict):
    event_type = event["type"]
    data = event["data"]

    if event_type == "payment.confirmed":
        await fulfill_order(data["metadata"]["order_id"])
    elif event_type == "payment.underpaid":
        await notify_underpaid(data["metadata"]["order_id"], data)
    elif event_type == "payment.expired":
        await handle_expired(data["metadata"].get("order_id"))`

const EXPRESS_HANDLER = `import express from "express";
import crypto from "crypto";

const app = express();
const WEBHOOK_SECRET = process.env.LENIS_WEBHOOK_SECRET!;
const processedEvents = new Set<string>();

app.post(
  "/webhooks/lenis",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = req.body as Buffer;
    const sigHeader = req.headers["x-lenis-signature"] as string;

    // Verify signature
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => p.split("=", 2) as [string, string])
    );
    const { t: ts, v1: v1Sig } = parts;

    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return res.status(400).json({ error: "Timestamp expired" });
    }

    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(\`\${ts}.\${rawBody}\`)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1Sig))) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString());

    // Deduplicate
    if (processedEvents.has(event.id)) {
      return res.json({ received: true });
    }
    processedEvents.add(event.id);

    // Respond immediately, process async
    res.json({ received: true });
    await processEvent(event);
  }
);`

const PHP_HANDLER = `<?php
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;

$app->post('/webhooks/lenis', function (Request $request, Response $response) {
    $rawBody = (string)$request->getBody();
    $sigHeader = $request->getHeaderLine('X-Lenis-Signature');
    $secret = $_ENV['LENIS_WEBHOOK_SECRET'];

    // Parse signature header
    $parts = [];
    foreach (explode(',', $sigHeader) as $part) {
        [$k, $v] = explode('=', $part, 2);
        $parts[$k] = $v;
    }

    // Verify timestamp tolerance (5 minutes)
    if (abs(time() - (int)$parts['t']) > 300) {
        return $response->withStatus(400);
    }

    // Verify HMAC-SHA256
    $signedPayload = $parts['t'] . '.' . $rawBody;
    $expected = hash_hmac('sha256', $signedPayload, $secret);
    if (!hash_equals($expected, $parts['v1'])) {
        return $response->withStatus(400);
    }

    $event = json_decode($rawBody, true);

    if ($event['type'] === 'payment.confirmed') {
        $orderId = $event['data']['metadata']['order_id'];
        fulfillOrder($orderId);
    }

    $response->getBody()->write(json_encode(['received' => true]));
    return $response->withHeader('Content-Type', 'application/json');
});`

export function WebhookHandlerSetup() {
  return (
    <>
      <SEOMeta
        title="Webhook Handler Setup — Lenis Developer Docs"
        description="Complete guide to setting up a production webhook handler: signature verification, idempotency, fast response, and background processing."
        ogTitle="Webhook Handler Setup — Lenis Developer Docs"
        ogDescription="Set up a production webhook handler in Python FastAPI, Node Express, or PHP."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Webhook Handler Setup
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        A production webhook handler needs to do four things correctly: verify signatures,
        deduplicate events, respond quickly, and process events reliably. This guide shows
        complete examples in three frameworks.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">The four requirements</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          {
            title: 'Verify signatures',
            desc: 'Always check the X-Lenis-Signature header before processing. Reject anything that fails.',
          },
          {
            title: 'Handle duplicates (idempotency)',
            desc: 'Lenis may deliver the same event more than once. Track processed event IDs and skip duplicates.',
          },
          {
            title: 'Respond within 30 seconds',
            desc: 'Return HTTP 200 immediately. Do processing in a background task to avoid triggering retries.',
          },
          {
            title: 'Process correct events',
            desc: 'Only fulfill on payment.confirmed. Handle payment.underpaid and payment.expired separately.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-slate-200 p-4">
            <h3 className="mb-1 font-semibold text-slate-900">{item.title}</h3>
            <p className="text-sm text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Python (FastAPI)
      </h2>
      <CodeSample code={FASTAPI_HANDLER} language="python" title="Python FastAPI handler" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Node.js (Express)
      </h2>
      <CodeSample code={EXPRESS_HANDLER} language="typescript" title="Node Express handler" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">PHP</h2>
      <CodeSample code={PHP_HANDLER} language="php" title="PHP (Slim Framework)" />

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-800">Production checklist</p>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          <li>☐ Signature verification implemented with constant-time comparison</li>
          <li>☐ Duplicate event handling (persistent store for event IDs in production)</li>
          <li>☐ Background processing for orders to respond within 30s</li>
          <li>☐ Webhook endpoint URL registered in Lenis dashboard</li>
          <li>☐ Test event sent and verified via dashboard</li>
          <li>☐ Webhook secret stored in environment variable, not code</li>
        </ul>
      </div>
    </>
  )
}
