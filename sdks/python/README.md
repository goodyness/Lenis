# lenis-python

Official Python SDK for the [Lenis](https://lenis.io) non-custodial crypto payment platform.

## Installation

```bash
pip install lenis-python
```

Requires Python 3.10 or newer.

## Quick start

### 1. Create a client

```python
from lenis import LenisClient

# Use a test key for development, live key for production
client = LenisClient(api_key="sk_test_your_api_key_here")
```

### 2. Create a payment intent

```python
payment = client.payments.create(
    amount="49.99",
    token_symbol="USDC",
    network="base",
    accepted_tokens=[
        {"token_symbol": "USDC", "network": "base"},
    ],
    customer_email="buyer@example.com",
    expires_in=3600,  # 1 hour
    metadata={"order_id": "ORD-1234"},
)

print(payment["id"])           # pay_...
print(payment["checkout_url"]) # https://...
print(payment["is_test"])      # True for sk_test_ keys
```

### 3. Retrieve and list payments

```python
# Retrieve by ID
p = client.payments.retrieve(payment["id"])

# List with filters
page = client.payments.list(status="confirmed", limit=20)
for p in page["data"]:
    print(p["id"], p["status"])

# Cursor pagination
if page["has_more"]:
    next_page = client.payments.list(cursor=page["next_cursor"])
```

### 4. Create a payment link

```python
link = client.payment_links.create(
    title="Coffee Tip",
    amount_mode="fixed",
    amount="5.00",
    accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    redirect_url="https://example.com/thank-you",
)

print(link["checkout_url"])
```

### 5. Verify a webhook signature

Lenis signs every webhook delivery with an HMAC-SHA256 signature. Verify it in your endpoint handler before processing the event:

```python
from fastapi import Request, HTTPException
from lenis import LenisClient, LenisWebhookSignatureError

client = LenisClient(api_key="sk_live_your_api_key_here")
WEBHOOK_SECRET = "your_endpoint_secret_from_dashboard"

async def webhook_handler(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("X-Lenis-Signature", "")

    try:
        event = client.webhooks.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except LenisWebhookSignatureError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if event["type"] == "payment.confirmed":
        order_id = event["data"]["metadata"].get("order_id")
        print(f"Payment confirmed for order {order_id}")

    return {"received": True}
```

## Error handling

```python
from lenis import LenisClient, LenisAuthError, LenisAPIError

client = LenisClient(api_key="sk_test_...")

try:
    payment = client.payments.retrieve("pay_nonexistent")
except LenisAuthError as e:
    print(f"Auth failed [{e.status_code}]: {e.error}")
except LenisAPIError as e:
    print(f"API error [{e.status_code}]: {e.error}")
    if e.param:
        print(f"  Problem field: {e.param}")
```

## Idempotent requests

Pass `idempotency_key` to any `create` call to make it safe to retry:

```python
import uuid

payment = client.payments.create(
    amount="100.00",
    token_symbol="USDC",
    network="base",
    accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    idempotency_key=str(uuid.uuid4()),
)
```

## Test mode vs live mode

- Keys prefixed `sk_test_` create payments tagged `is_test=True`. They are never visible to live keys.
- Keys prefixed `sk_live_` create live payments. Live payments are never visible to test keys.

Switch simply by changing the key passed to `LenisClient`.

## Full documentation

See the [Lenis Developer Docs](https://lenis.io/docs) for the complete API reference, supported networks, webhook event types, and integration guides.
