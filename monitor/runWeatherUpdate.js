/**
 * runWeatherUpdate.js
 * ───────────────────
 * Standalone script to trigger the weather-based premium modifier
 * update on demand — useful for demos and testing.
 *
 * Usage:  node monitor/runWeatherUpdate.js
 *
 * Initialises Firebase Admin (same pattern as monitor_index.js),
 * runs runWeatherPremiumUpdate() once, then exits.
 */

const admin = require('firebase-admin');
const { runWeatherPremiumUpdate } = require('./weatherPremiumModifier');

// ─── Firebase init (mirrors monitor_index.js) ────────────────────────────────
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'gigguard-5bb97',
  });
}

const db = admin.firestore();

// ─── Run once and exit ───────────────────────────────────────────────────────
console.log('🚀 Running weather premium modifier update (standalone)...\n');

runWeatherPremiumUpdate(db, admin)
  .then(() => {
    console.log('\n✅ Done.');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Failed:', err);
    process.exit(1);
  });
