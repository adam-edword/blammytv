// One-command Stripe storefront setup for the theme shop. Creates (or finds —
// every step is IDEMPOTENT, safe to rerun) the products, one-time prices,
// Payment Links, and the webhook endpoint, then prints everything that needs
// pasting into catalog.json and the app's themePacks.ts.
//
// Run it wherever STRIPE_API_KEY is set — inside the Coolify container is
// easiest (same env the server uses):
//
//   node scripts/setup-stripe.mjs
//
// A TEST key (sk_test_...) builds the whole store in test mode for a dry run;
// the LIVE key builds the real one. Idempotency is keyed on product/link
// metadata (blammytv_item), so reruns reuse instead of duplicating.
//
// BASE_URL (default https://themes.eddtv.org) is where /success and /webhook
// live. The webhook signing secret is only revealed on CREATION — if the
// endpoint already exists, fetch the secret from the Stripe dashboard instead.
import Stripe from "stripe";

const API_KEY = process.env.STRIPE_API_KEY;
if (!API_KEY) {
  console.error("STRIPE_API_KEY is not set");
  process.exit(1);
}
const BASE_URL = process.env.BASE_URL ?? "https://themes.eddtv.org";
const stripe = new Stripe(API_KEY);
const mode = API_KEY.startsWith("sk_live") ? "LIVE" : "test";

/** The storefront. Amounts in cents. Keep ids in sync with the app's
 * themePacks.ts / catalog.json — "pass" is the Themes Pass, the rest are
 * per-theme purchases. */
const ITEMS = [
  { key: "pass", name: "BlammyTV Themes Pass", amount: 1250 },
  { key: "terminal", name: "BlammyTV Theme — Terminal", amount: 250 },
  { key: "dither", name: "BlammyTV Theme — Dither", amount: 250 },
  { key: "kawaii", name: "BlammyTV Theme — Kawaii", amount: 250 },
  { key: "streamy", name: "BlammyTV Theme — Streamy", amount: 250 },
];

async function findProduct(itemKey) {
  // products.search needs a few seconds of indexing lag on fresh objects;
  // a plain list+filter is instantly consistent and fine at this scale.
  const products = await stripe.products.list({ limit: 100, active: true });
  return products.data.find((p) => p.metadata?.blammytv_item === itemKey) ?? null;
}

async function ensurePrice(product, amount) {
  if (product.default_price) {
    const price = await stripe.prices.retrieve(String(product.default_price));
    if (price.unit_amount === amount && price.currency === "usd" && price.active) {
      return price;
    }
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: "usd",
  });
  await stripe.products.update(product.id, { default_price: price.id });
  return price;
}

async function findPaymentLink(itemKey) {
  const links = await stripe.paymentLinks.list({ limit: 100, active: true });
  return links.data.find((l) => l.metadata?.blammytv_item === itemKey) ?? null;
}

const out = { passPriceIds: [], themes: {}, links: {} };

for (const item of ITEMS) {
  let product = await findProduct(item.key);
  if (!product) {
    product = await stripe.products.create({
      name: item.name,
      metadata: { blammytv_item: item.key },
    });
    console.log(`created product ${item.name} (${product.id})`);
  } else {
    console.log(`found product ${item.name} (${product.id})`);
  }

  const price = await ensurePrice(product, item.amount);
  console.log(`  price ${price.id} — $${(item.amount / 100).toFixed(2)}`);

  let link = await findPaymentLink(item.key);
  if (!link) {
    link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { blammytv_item: item.key },
      after_completion: {
        type: "redirect",
        redirect: { url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}` },
      },
    });
    console.log(`  payment link created: ${link.url}`);
  } else {
    console.log(`  payment link exists:  ${link.url}`);
  }

  if (item.key === "pass") out.passPriceIds.push(price.id);
  else out.themes[item.key] = { priceId: price.id };
  out.links[item.key] = link.url;
}

// Webhook endpoint → checkout.session.completed only. The signing secret is
// returned ONLY when the endpoint is created.
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
const hookUrl = `${BASE_URL}/webhook`;
let hook = hooks.data.find((h) => h.url === hookUrl);
if (!hook) {
  hook = await stripe.webhookEndpoints.create({
    url: hookUrl,
    enabled_events: ["checkout.session.completed"],
    description: "keybox — mints theme keys on purchase",
  });
  console.log(`\nwebhook endpoint created: ${hookUrl}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${hook.secret}   <-- set this in Coolify NOW (shown only once)`);
} else {
  console.log(`\nwebhook endpoint exists: ${hookUrl} (${hook.id})`);
  console.log("  (secret not shown for existing endpoints — see the Stripe dashboard)");
}

console.log(`\n=== ${mode} MODE RESULTS — paste back for wiring ===`);
console.log(JSON.stringify(out, null, 2));
