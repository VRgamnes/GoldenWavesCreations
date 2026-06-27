// fetch-etsy.js
// Run by GitHub Actions to pull your Etsy listings & reviews into products.json
// Requires env vars: ETSY_API_KEY, ETSY_SHOP_ID

const https = require('https');
const fs    = require('fs');

const API_KEY  = process.env.ETSY_API_KEY;
const SHOP_ID  = process.env.ETSY_SHOP_ID;

if (!API_KEY || !SHOP_ID) {
  console.error('❌  Missing ETSY_API_KEY or ETSY_SHOP_ID environment variables.');
  process.exit(1);
}

// ── HTTP helper ─────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'x-api-key': API_KEY } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          resolve(JSON.parse(body));
        }
      });
    });
    req.on('error', reject);
  });
}

// ── Price helper ─────────────────────────────────────────────────
function parsePrice(priceObj) {
  if (!priceObj) return null;
  return parseFloat((priceObj.amount / priceObj.divisor).toFixed(2));
}

// ── Fetch listings ───────────────────────────────────────────────
async function fetchListings() {
  let all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://openapi.etsy.com/v3/application/shops/${SHOP_ID}/listings/active`
      + `?includes[]=images&includes[]=shipping_profile`
      + `&limit=${limit}&offset=${offset}`;

    const data = await get(url);
    const results = data.results || [];
    all = all.concat(results);

    if (results.length < limit) break; // no more pages
    offset += limit;
  }

  return all;
}

// ── Fetch shop info ──────────────────────────────────────────────
async function fetchShop() {
  try {
    const data = await get(`https://openapi.etsy.com/v3/application/shops/${SHOP_ID}`);
    return data;
  } catch (e) {
    console.warn('Could not fetch shop info:', e.message);
    return null;
  }
}

// ── Fetch reviews ────────────────────────────────────────────────
async function fetchReviews() {
  try {
    const data = await get(
      `https://openapi.etsy.com/v3/application/shops/${SHOP_ID}/reviews?limit=20`
    );
    return data.results || [];
  } catch (e) {
    console.warn('Could not fetch reviews:', e.message);
    return [];
  }
}

// ── Transform listing ────────────────────────────────────────────
function transformListing(listing) {
  const currentPrice  = parsePrice(listing.price);
  // Etsy v3: non_discounted_price is the original before sale (if on sale)
  const originalPrice = parsePrice(listing.non_discounted_price) || null;

  // Images
  const images = (listing.images || []).map(img =>
    img.url_570xN || img.url_fullxfull || img.url_170x170 || ''
  );

  // Shipping estimate from profile (Printify typically ships in 3-7 production + 3-7 transit)
  let minShip = 7;
  let maxShip = 14;
  if (listing.shipping_profile) {
    const sp = listing.shipping_profile;
    if (sp.min_processing_days != null && sp.max_processing_days != null) {
      minShip = (sp.min_processing_days || 3) + 3;
      maxShip = (sp.max_processing_days || 7) + 7;
    }
  }

  return {
    id:            listing.listing_id,
    title:         listing.title,
    description:   listing.description ? listing.description.slice(0, 300) : '',
    price:         currentPrice,
    originalPrice: originalPrice !== currentPrice ? originalPrice : null,
    currency:      listing.price?.currency_code || 'USD',
    imageUrl:      images[0] || '',
    images,
    url:           `https://www.etsy.com/listing/${listing.listing_id}`,
    tags:          listing.tags || [],
    quantity:      listing.quantity,
    minShippingDays: minShip,
    maxShippingDays: maxShip,
    isActive:      true,
    isTest:        false,
    updatedAt:     new Date().toISOString()
  };
}

// ── Transform review ─────────────────────────────────────────────
function transformReview(review) {
  return {
    rating:       review.rating,
    review:       review.review || '',
    reviewer:     'Verified Buyer',
    listingTitle: review.listing_id ? `Listing #${review.listing_id}` : '',
    date:         review.create_timestamp
      ? new Date(review.create_timestamp * 1000).toISOString()
      : new Date().toISOString()
  };
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('🔄  Fetching Etsy data for shop', SHOP_ID, '...');

  const [listings, shop, rawReviews] = await Promise.all([
    fetchListings(),
    fetchShop(),
    fetchReviews()
  ]);

  const products = listings.map(transformListing);
  const reviews  = rawReviews.map(transformReview);

  const output = {
    lastUpdated: new Date().toISOString(),
    shopId:      SHOP_ID,
    shopName:    shop?.shop_name  || 'My Shop',
    shopUrl:     shop ? `https://www.etsy.com/shop/${shop.shop_name}` : '',
    products,
    reviews
  };

  fs.writeFileSync('products.json', JSON.stringify(output, null, 2));
  console.log(`✅  Saved ${products.length} products and ${reviews.length} reviews to products.json`);
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
