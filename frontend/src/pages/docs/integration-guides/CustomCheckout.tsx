import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const CREATE_PAYMENT_TS = `// 1. Create payment intent on your backend
const response = await fetch("/api/payments/create", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ orderId: "1234", amount: "100.00" }),
});
const { paymentId, paymentAddress, expiresAt } = await response.json();`

const POLLING_TS = `// 2a. Poll approach — check status every 10 seconds
async function pollPaymentStatus(paymentId: string): Promise<string> {
  const maxAttempts = 36; // 6 minutes
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    attempts++;

    const response = await fetch(\`/api/payments/\${paymentId}/status\`);
    const { status } = await response.json();

    if (status === "confirmed") return "confirmed";
    if (status === "expired" || status === "underpaid") return status;
    // Still pending, detecting, or confirming — keep polling
  }

  return "timeout";
}

const finalStatus = await pollPaymentStatus(paymentId);
if (finalStatus === "confirmed") {
  showSuccessScreen();
} else if (finalStatus === "expired") {
  showExpiredScreen();
}`

const WEBHOOK_APPROACH_TS = `// 2b. Webhook approach — listen for server-sent events from your backend
// Your backend listens for Lenis webhooks and broadcasts status updates

const eventSource = new EventSource(\`/api/payments/\${paymentId}/events\`);

eventSource.addEventListener("payment.confirmed", () => {
  eventSource.close();
  showSuccessScreen();
});

eventSource.addEventListener("payment.expired", () => {
  eventSource.close();
  showExpiredScreen();
});

eventSource.addEventListener("payment.underpaid", (e) => {
  const { amountReceived, amountRequired } = JSON.parse(e.data);
  eventSource.close();
  showUnderpaidScreen(amountReceived, amountRequired);
});`

const DISPLAY_TS = `// Display the payment address and countdown timer
function PaymentWidget({
  paymentAddress,
  expiresAt,
}: {
  paymentAddress: string;
  expiresAt: string;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div>
      <p>Send exactly <strong>100.00 USDC</strong> to:</p>
      <code>{paymentAddress}</code>
      <p>Expires in: {minutes}:{String(seconds).padStart(2, "0")}</p>
    </div>
  );
}`

export function CustomCheckout() {
  return (
    <>
      <SEOMeta
        title="Custom Checkout Flow — Lenis Developer Docs"
        description="Build a custom crypto checkout experience using the Lenis API directly, with polling and webhook approaches for status updates."
        ogTitle="Custom Checkout Flow — Lenis Developer Docs"
        ogDescription="Build your own checkout UI using the Lenis API: create payment intents, display the payment address, and track status via polling or webhooks."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Custom Checkout Flow
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        If you want full control over your payment UI, you can build a custom checkout
        experience using the Lenis API directly. This guide covers both a polling approach
        and a webhook-driven approach for real-time status updates.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Step 1: Create the payment intent
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Create the payment intent on your backend and return the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">payment_address</code> and{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">expires_at</code> to your frontend:
      </p>
      <CodeSample code={CREATE_PAYMENT_TS} language="typescript" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Step 2: Display the payment address
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Show the payment address as text (and optionally as a QR code) along with a countdown
        timer derived from <code className="bg-slate-100 px-1 rounded text-sm">expires_at</code>:
      </p>
      <CodeSample code={DISPLAY_TS} language="typescript" title="React payment widget" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Step 3a: Track status via polling
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        The simplest approach — poll your backend (which proxies{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">GET /v1/payments/{'{id}'}</code>)
        every 10 seconds:
      </p>
      <CodeSample code={POLLING_TS} language="typescript" title="Status polling" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Step 3b: Track status via webhooks (recommended)
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        For a better user experience, use Server-Sent Events (SSE) or WebSockets from
        your backend, bridging Lenis webhooks to your frontend:
      </p>
      <CodeSample code={WEBHOOK_APPROACH_TS} language="typescript" title="SSE approach" />

      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">Polling vs webhooks</p>
        <p className="mt-1 text-sm text-blue-700">
          Polling is simpler to implement but introduces up to 10 seconds of latency. Webhooks
          with SSE give near-instant UI updates but require your backend to bridge the events.
          For production, the webhook approach provides a much better user experience.
        </p>
      </div>
    </>
  )
}
