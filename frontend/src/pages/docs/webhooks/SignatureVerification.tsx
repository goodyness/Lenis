import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const PYTHON_VERIFY = `import hmac, hashlib, time
from fastapi import Request, HTTPException

WEBHOOK_SECRET = "whsec_your_secret_here"

def verify_lenis_signature(request_body: bytes, sig_header: str) -> None:
    """Raises HTTPException if signature verification fails."""
    try:
        parts = dict(p.split("=", 1) for p in sig_header.split(","))
        timestamp = parts["t"]
        v1_signature = parts["v1"]
    except (ValueError, KeyError):
        raise HTTPException(400, "Malformed X-Lenis-Signature header")

    # Reject requests older than 5 minutes
    if abs(time.time() - int(timestamp)) > 300:
        raise HTTPException(400, "Timestamp outside tolerance window")

    # Compute expected signature
    signed_payload = f"{timestamp}.{request_body.decode()}"
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        signed_payload.encode(),
        hashlib.sha256
    ).hexdigest()

    # Use constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(expected, v1_signature):
        raise HTTPException(400, "Signature mismatch")`

const NODE_VERIFY = `import crypto from "crypto";

const WEBHOOK_SECRET = process.env.LENIS_WEBHOOK_SECRET!;

function verifyLenisSignature(
  rawBody: Buffer,
  sigHeader: string
): void {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=", 2) as [string, string])
  );
  const { t: timestamp, v1: v1Sig } = parts;

  if (!timestamp || !v1Sig) {
    throw new Error("Malformed X-Lenis-Signature header");
  }

  // Reject stale requests (> 5 minutes old)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error("Timestamp outside tolerance window");
  }

  const signedPayload = \`\${timestamp}.\${rawBody.toString()}\`;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1Sig))) {
    throw new Error("Signature mismatch");
  }
}`

const PHP_VERIFY = `<?php
function verify_lenis_signature(string $rawBody, string $sigHeader): void {
    $parts = [];
    foreach (explode(',', $sigHeader) as $part) {
        [$key, $value] = explode('=', $part, 2);
        $parts[$key] = $value;
    }

    if (empty($parts['t']) || empty($parts['v1'])) {
        throw new \RuntimeException('Malformed X-Lenis-Signature header');
    }

    $timestamp = (int)$parts['t'];
    $v1Sig = $parts['v1'];

    // Reject requests older than 5 minutes
    if (abs(time() - $timestamp) > 300) {
        throw new \RuntimeException('Timestamp outside tolerance window');
    }

    $signedPayload = $timestamp . '.' . $rawBody;
    $expected = hash_hmac('sha256', $signedPayload, $_ENV['LENIS_WEBHOOK_SECRET']);

    // Constant-time comparison
    if (!hash_equals($expected, $v1Sig)) {
        throw new \RuntimeException('Signature mismatch');
    }
}`

export function SignatureVerification() {
  return (
    <>
      <SEOMeta
        title="Webhook Signature Verification — Lenis Developer Docs"
        description="Learn how to verify Lenis webhook signatures using HMAC-SHA256 to ensure events are genuinely from Lenis."
        ogTitle="Webhook Signature Verification — Lenis Developer Docs"
        ogDescription="Verify the X-Lenis-Signature header using HMAC-SHA256 to secure your webhook handler."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Signature Verification
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Every webhook request from Lenis includes an{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header.
        Verifying this signature proves the request genuinely came from Lenis and that the
        payload hasn't been tampered with.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">The signature scheme</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Lenis uses HMAC-SHA256 to sign webhook payloads. The signature header format is:
      </p>
      <CodeSample
        code={`X-Lenis-Signature: t=1704067200,v1=a4d8e1f0c3b2...`}
        language="http"
      />
      <p className="mt-3 mb-4 text-slate-600 leading-relaxed">
        Where:
      </p>
      <ul className="mb-6 space-y-2 text-slate-600">
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">t</code> — Unix timestamp (seconds) of when the event was signed
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">v1</code> — HMAC-SHA256 hex digest of{' '}
          <code className="bg-slate-100 px-1 rounded text-sm">{"${timestamp}.${raw_body}"}</code>
        </li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Verification steps
      </h2>
      <ol className="mb-6 space-y-3 text-slate-600">
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">1</span>
          <span>Parse the <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header to extract <code className="bg-slate-100 px-1 rounded text-sm">t</code> and <code className="bg-slate-100 px-1 rounded text-sm">v1</code>.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">2</span>
          <span>Check that <code className="bg-slate-100 px-1 rounded text-sm">|time.now() - t|</code> is within 300 seconds. Reject if not.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">3</span>
          <span>Compute <code className="bg-slate-100 px-1 rounded text-sm">HMAC-SHA256(secret, "{'{t}'}.{'{raw_body}'}")</code>.</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">4</span>
          <span>Compare using a constant-time comparison to prevent timing attacks.</span>
        </li>
      </ol>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">
          ⚠ Always use constant-time comparison
        </p>
        <p className="mt-1 text-sm text-amber-700">
          Regular string equality (<code className="bg-amber-100 px-1 rounded">==</code>) is vulnerable to
          timing attacks. Use <code className="bg-amber-100 px-1 rounded">hmac.compare_digest</code> (Python),{' '}
          <code className="bg-amber-100 px-1 rounded">crypto.timingSafeEqual</code> (Node.js), or{' '}
          <code className="bg-amber-100 px-1 rounded">hash_equals</code> (PHP).
        </p>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Code samples</h2>
      <CodeSample code={PYTHON_VERIFY} language="python" title="Python" />
      <CodeSample code={NODE_VERIFY} language="typescript" title="Node.js (TypeScript)" />
      <CodeSample code={PHP_VERIFY} language="php" title="PHP" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Tolerance window</h2>
      <p className="text-slate-600 leading-relaxed">
        The tolerance window is <strong>300 seconds (5 minutes)</strong>. This prevents replay
        attacks while allowing for reasonable clock drift between Lenis servers and your handler.
        Reject any event with a timestamp outside this window.
      </p>
    </>
  )
}
