# lenis-node

Official Node.js / TypeScript SDK for the [Lenis](https://lenis.io) crypto payment platform.

## Installation

```bash
npm install lenis-node
```

## Quick Start

```typescript
import { Lenis } from 'lenis-node';

const client = new Lenis({ apiKey: 'sk_live_your_key_here' });

// Create a payment intent
const payment = await client.payments.create({
  amount: '100.00',
  token_symbol: 'USDC',
  network: 'base',
  accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
  customer_email: 'user@example.com',
  expires_in: 3600,
});

console.log(payment.checkout_url);

// List payments
const { data, has_more } = await client.payments.list({ limit: 10 });

// Create a payment link
const link = await client.paymentLinks.create({
  title: 'My Product',
  amount_mode: 'fixed',
  amount: '49.99',
  accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
});

console.log(link.checkout_url);
```

## Webhook Signature Verification

Verify incoming webhook deliveries using the `constructEvent` helper:

```typescript
import { Lenis, LenisWebhookSignatureError } from 'lenis-node';

const client = new Lenis({ apiKey: process.env.LENIS_API_KEY! });

// Express example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-lenis-signature'] as string;

  try {
    const event = client.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET!);
    console.log('Received event:', event.type);
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof LenisWebhookSignatureError) {
      res.status(400).send('Invalid signature');
    } else {
      res.sendStatus(500);
    }
  }
});
```

## Error Handling

```typescript
import { Lenis, LenisAuthError, LenisAPIError, LenisWebhookSignatureError } from 'lenis-node';

try {
  const payment = await client.payments.retrieve('pay_nonexistent');
} catch (err) {
  if (err instanceof LenisAuthError) {
    console.error('Auth failed:', err.error);          // e.g. "invalid_api_key"
  } else if (err instanceof LenisAPIError) {
    console.error('API error:', err.statusCode, err.error, err.param);
  }
}

// Empty key throws immediately — no network request made
try {
  const bad = new Lenis({ apiKey: '' });
} catch (err) {
  // err is LenisAuthError with statusCode 0
}
```

## Test Mode

Use `sk_test_*` keys to work in test mode. Payments created with test keys are isolated from live payments.

```typescript
const testClient = new Lenis({ apiKey: 'sk_test_your_test_key_here' });
```

## Custom Base URL

```typescript
const client = new Lenis({
  apiKey: 'sk_live_...',
  baseUrl: 'https://api.your-lenis-instance.com',
});
```
