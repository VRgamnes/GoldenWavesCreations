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
      + `?includes[]=Images&includes[]=Shipping&limit=100&offset=${offset}`;
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

  // Images can come back under different shapes depending on the includes
  // response — check the common ones.
  let imagesRaw = listing.images || listing.Images || [];
  if (!Array.isArray(imagesRaw)) imagesRaw = [];
  const images = imagesRaw
    .map(i => i.url_570xN || i.url_fullxfull || i.url_170x170 || i.url_75x75 || '')
    .filter(Boolean);

  let minShip = 7, maxShip = 14;
  const sp = listing.shipping_profile || listing.Shipping || listing.shipping;
  if (sp) {
    minShip = (sp.min_processing_days || sp.processing_min || 3) + 3;
    maxShip = (sp.max_processing_days || sp.processing_max || 7) + 7;
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
  if (listings[0]) {
    console.log('Sample listing keys:', Object.keys(listings[0]));
    console.log('Sample images field:', JSON.stringify(listings[0].images || listings[0].Images || 'NONE').slice(0, 300));
  }
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
