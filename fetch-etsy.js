// fetch-etsy.js
// Pulls your public Etsy listings into products.json
// Requires: ETSY_API_KEY (the Keystring only) and ETSY_SHOP_ID

const https = require('https');
const fs    = require('fs');

const API_KEY       = process.env.ETSY_API_KEY;
const SHARED_SECRET  = process.env.ETSY_SHARED_SECRET;
const SHOP_ID        = process.env.ETSY_SHOP_ID;

if (!API_KEY)      { console.error('Missing ETSY_API_KEY'); process.exit(1); }
if (!SHARED_SECRET){ console.error('Missing ETSY_SHARED_SECRET'); process.exit(1); }
if (!SHOP_ID)       { console.error('Missing ETSY_SHOP_ID'); process.exit(1); }

// Etsy requires BOTH the keystring and shared secret in the x-api-key header,
// joined by a colon, like: keystring:sharedsecret
const X_API_KEY_HEADER = `${API_KEY}:${SHARED_SECRET}`;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'x-api-key': X_API_KEY_HEADER } }, res => {
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

function parsePrice(p) {
  if (!p) return null;
  return parseFloat((p.amount / p.divisor).toFixed(2));
}

async function fetchListings() {
  let all = [], offset = 0;
  while (true) {
    const url = `https://openapi.etsy.com/v3/application/shops/${SHOP_ID}/listings/active`
      + `?includes[]=images&includes[]=shipping_profile&limit=100&offset=${offset}`;
    const data = await get(url);
    const results = data.results || [];
    all = all.concat(results);
    if (results.length < 100) break;
    offset += 100;
  }
  return all;
}

async function fetchShop() {
  try { return await get(`https://openapi.etsy.com/v3/application/shops/${SHOP_ID}`); }
  catch (e) { console.warn('Could not fetch shop info:', e.message); return null; }
}

function transformListing(listing) {
  const currentPrice  = parsePrice(listing.price);
  const originalPrice = parsePrice(listing.non_discounted_price);
  const images = (listing.images || []).map(i => i.url_570xN || i.url_fullxfull || '');
  let minShip = 7, maxShip = 14;
  if (listing.shipping_profile) {
    minShip = (listing.shipping_profile.min_processing_days || 3) + 3;
    maxShip = (listing.shipping_profile.max_processing_days || 7) + 7;
  }
  return {
    id:              listing.listing_id,
    title:           listing.title,
    description:     (listing.description || '').slice(0, 300),
    price:           currentPrice,
    originalPrice:   originalPrice && originalPrice !== currentPrice ? originalPrice : null,
    currency:        listing.price?.currency_code || 'USD',
    imageUrl:        images[0] || '',
    images,
    url:             `https://www.etsy.com/listing/${listing.listing_id}`,
    tags:            listing.tags || [],
    quantity:        listing.quantity,
    minShippingDays: minShip,
    maxShippingDays: maxShip,
    isActive:        true,
    isTest:          false,
    updatedAt:       new Date().toISOString()
  };
}

async function main() {
  console.log('Fetching Etsy listings for shop ID:', SHOP_ID);

  const listings = await fetchListings();
  const shop = await fetchShop();
  const products = listings.map(transformListing);

  // Reviews require OAuth (not just an API key), so we keep any reviews
  // you've manually added via the admin panel, and just update products.
  let existingReviews = [];
  try {
    const existing = JSON.parse(fs.readFileSync('products.json', 'utf8'));
    existingReviews = existing.reviews || [];
  } catch (e) { /* no existing file yet, that's fine */ }

  const output = {
    lastUpdated: new Date().toISOString(),
    shopId:      SHOP_ID,
    shopName:    shop?.shop_name || 'GoldenWavesCreations',
    shopUrl:     `https://www.etsy.com/shop/${shop?.shop_name || 'GoldenWavesCreations'}`,
    products,
    reviews: existingReviews
  };

  fs.writeFileSync('products.json', JSON.stringify(output, null, 2));
  console.log(`Saved ${products.length} products to products.json`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
