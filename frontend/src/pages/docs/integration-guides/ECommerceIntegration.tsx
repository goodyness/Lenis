import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const FASTAPI_CHECKOUT = `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import requests, os

app = FastAPI()
LENIS_API_KEY = os.environ["LENIS_API_KEY"]

class OrderCheckoutRequest(BaseModel):
    order_id: str
    amount: str
    currency: str = "USDC"
    network: str = "polygon"

@app.post("/checkout/create")
def create_checkout(req: OrderCheckoutRequest):
    """Create a Lenis payment intent for an order."""
    response = requests.post(
        "https://api.lenis.io/v1/payments",
        headers={
            "Authorization": f"Bearer {LENIS_API_KEY}",
            "Idempotency-Key": f"order-{req.order_id}-checkout-1",
        },
        json={
            "amount": req.amount,
            "currency": req.currency,
            "network": req.network,
            "description": f"Order #{req.order_id}",
            "metadata": {"order_id": req.order_id},
            "redirect_url": f"https://yourstore.com/orders/{req.order_id}/thank-you",
        },
    )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Payment gateway error")

    payment = response.json()
    # Redirect customer to Lenis-hosted checkout
    return {"checkout_url": payment["checkout_url"]}

@app.post("/webhooks/lenis")
async def handle_payment_webhook(request):
    # See Signature Verification docs for full implementation
    event = await request.json()

    if event["type"] == "payment.confirmed":
        order_id = event["data"]["metadata"]["order_id"]
        mark_order_paid(order_id)
        send_fulfillment_email(order_id)

    return {"received": True}

def mark_order_paid(order_id: str):
    # Update order status in your database
    pass

def send_fulfillment_email(order_id: str):
    # Send confirmation email to customer
    pass`

export function ECommerceIntegration() {
  return (
    <>
      <SEOMeta
        title="E-Commerce Integration — Lenis Developer Docs"
        description="Integrate Lenis into your e-commerce checkout flow: create payment intents on order, redirect to checkout URL, and fulfill on webhook confirmation."
        ogTitle="E-Commerce Integration Guide — Lenis Developer Docs"
        ogDescription="Step-by-step guide to adding crypto payments to your e-commerce store with Lenis."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        E-Commerce Integration
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        This guide walks through adding crypto checkout to an e-commerce store using the
        Lenis-hosted checkout page — the fastest path to accepting payments.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">How it works</h2>
      <div className="mb-6 flex flex-col gap-2">
        {[
          { step: '1', label: 'Customer places order', desc: 'Your store captures the order details and total.' },
          { step: '2', label: 'Create payment intent', desc: 'Your backend calls POST /v1/payments with the order amount and metadata.' },
          { step: '3', label: 'Redirect to checkout', desc: 'Redirect the customer to the checkout_url returned by Lenis.' },
          { step: '4', label: 'Customer pays', desc: 'Customer scans the QR code or sends to the payment address.' },
          { step: '5', label: 'Webhook fires', desc: 'Lenis sends a payment.confirmed event to your webhook endpoint.' },
          { step: '6', label: 'Fulfill the order', desc: 'Your handler marks the order as paid and triggers fulfillment.' },
        ].map((item) => (
          <div key={item.step} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {item.step}
            </span>
            <div>
              <span className="font-medium text-slate-900">{item.label}</span>
              <span className="ml-2 text-slate-600 text-sm">{item.desc}</span>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Implementation (FastAPI)
      </h2>
      <CodeSample
        code={FASTAPI_CHECKOUT}
        language="python"
        title="E-commerce checkout with FastAPI"
      />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Key considerations</h2>
      <ul className="space-y-3 text-slate-600">
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Use idempotency keys.</strong> Include a
            key like <code className="bg-slate-100 px-1 rounded text-sm">order-{'{id}'}-checkout-1</code>{' '}
            so that network retries don't create duplicate payment intents.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Pass metadata.</strong> Include your internal
            order ID in the <code className="bg-slate-100 px-1 rounded text-sm">metadata</code> object
            so your webhook handler can look up the right order.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Fulfill only on confirmed.</strong> Only
            the <code className="bg-slate-100 px-1 rounded text-sm">payment.confirmed</code> event
            guarantees the payment is settled. Don't fulfill on <code className="bg-slate-100 px-1 rounded text-sm">payment.detecting</code>.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Handle underpaid.</strong> If the customer
            sends less than required, you'll receive a{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">payment.underpaid</code> event.
            Decide whether to accept, request a top-up, or refund.
          </span>
        </li>
      </ul>
    </>
  )
}
