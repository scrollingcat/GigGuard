/**
 * GigGuard App Downtime Monitor
 * ──────────────────────────────
 * Runs as a standalone Node.js service on Render (free tier).
 *
 * What it does:
 * 1. Every hour  → pings all 5 delivery apps, logs status to Firestore
 * 2. Every Sunday 11:59pm → scans all workers with Standard/Premium plans,
 *    calculates payout based on downtime during their shift hours,
 *    auto-creates approved claims in Firestore
 *
 * Payout rules:
 * - ₹30 per hour of downtime during worker's active shift
 * - Only Standard and Premium plan workers qualify
 * - Payout capped at worker's policy coverageAmount
 * - Claims are auto-approved (no AI scoring needed — system verified)
 *
 * Shift hours:
 * - morning   → 6am  to 12pm
 * - afternoon → 12pm to 5pm
 * - evening   → 5pm  to 9pm
 * - night     → 9pm  to 6am (next day)
 *
 * Firestore collections used:
 * - app_downtime_logs  → hourly ping results per app
 * - workers            → read worker profiles
 * - policies           → read active policies (filter Standard/Premium)
 * - claims             → write auto-approved payout claims
 */

const admin   = require('firebase-admin');
const cron    = require('node-cron');
const fetch   = require('node-fetch');

// ─── Firebase init ───────────────────────────────────────────────────────────
// Set GOOGLE_APPLICATION_CREDENTIALS env var on Render to your service account JSON path
// OR paste the service account JSON directly into FIREBASE_SERVICE_ACCOUNT env var
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  // Local dev: place serviceAccountKey.json in /monitor folder
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'gigguard-5bb97',
  });
}

const db = admin.firestore();

// ─── App definitions ─────────────────────────────────────────────────────────
const APPS = [
  { id: 'swiggy_instamart', label: 'Swiggy Instamart', url: 'https://www.swiggy.com' },
  { id: 'zepto',            label: 'Zepto',            url: 'https://www.zepto.com' },
  { id: 'blinkit',          label: 'Blinkit',          url: 'https://blinkit.com' },
  { id: 'flipkart_minutes', label: 'Flipkart Minutes', url: 'https://www.flipkart.com/flipkart-minutes-store' },
  { id: 'instablink',       label: 'Instablink',       url: 'https://instablink.onrender.com/' },
];

// Eligible plans for auto-payout
const ELIGIBLE_PLANS = ['standard', 'premium'];

// Payout per hour of downtime (₹)
const PAYOUT_PER_HOUR = 30;

// Shift hours [start, end] in 24h — end is exclusive
const SHIFT_HOURS = {
  morning:   { start: 6,  end: 12 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 21 },
  night:     { start: 21, end: 30 }, // 30 = 6am next day (we handle wrap-around)
};

// ─── HELPER: Check if a single app is up ─────────────────────────────────────
async function pingApp(app) {
  const start = Date.now();
  try {
    const res = await fetch(app.url, {
      method: 'GET',
      timeout: 10000, // 10s timeout
      headers: { 'User-Agent': 'GigGuard-Monitor/1.0' },
    });
    const responseTime = Date.now() - start;
    // Consider down if status >= 500 or response took > 8s
    const isDown = res.status >= 500 || responseTime > 8000;
    return {
      appId:        app.id,
      appLabel:     app.label,
      url:          app.url,
      status:       res.status,
      responseTime,
      isDown,
      reason:       isDown ? (res.status >= 500 ? `HTTP ${res.status}` : 'Timeout') : null,
    };
  } catch (err) {
    return {
      appId:        app.id,
      appLabel:     app.label,
      url:          app.url,
      status:       0,
      responseTime: Date.now() - start,
      isDown:       true,
      reason:       err.message,
    };
  }
}

// ─── HELPER: Check if an hour falls within a worker's shift ──────────────────
function isHourInShift(hour, shiftPattern) {
  const shift = SHIFT_HOURS[shiftPattern];
  if (!shift) return false;

  if (shiftPattern === 'night') {
    // Night shift wraps midnight: 9pm(21) to 6am(6)
    return hour >= 21 || hour < 6;
  }
  return hour >= shift.start && hour < shift.end;
}

// ─── JOB 1: Hourly ping — runs every hour at :00 ─────────────────────────────
async function runHourlyPing() {
  const now       = new Date();
  const hourLabel = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}`;

  console.log(`\n[${new Date().toISOString()}] Running hourly ping...`);

  const results = await Promise.all(APPS.map(pingApp));
  const batch   = db.batch();

  for (const result of results) {
    const docId = `${result.appId}_${hourLabel}`;
    const ref   = db.collection('app_downtime_logs').doc(docId);
    batch.set(ref, {
      ...result,
      hour:       now.getHours(),
      date:       `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
      weekNumber: getWeekNumber(now),
      checkedAt:  admin.firestore.Timestamp.now(),
    });

    const statusIcon = result.isDown ? '🔴 DOWN' : '🟢 UP';
    console.log(`  ${statusIcon} ${result.appLabel} (${result.responseTime}ms)`);
    if (result.isDown) console.log(`         Reason: ${result.reason}`);
  }

  await batch.commit();
  console.log(`  ✓ Logged ${results.length} app statuses to Firestore`);
}

// ─── JOB 2: Weekly payout — runs every Sunday at 11:59pm ─────────────────────
async function runWeeklyPayout() {
  console.log(`\n[${new Date().toISOString()}] Running weekly payout calculation...`);

  const now     = new Date();
  const weekNum = getWeekNumber(now);

  // Get the date range for this week (Mon–Sun)
  const weekDates = getWeekDates(now);
  console.log(`  Processing week: ${weekDates[0]} to ${weekDates[6]}`);

  // 1. Fetch all active policies that are Standard or Premium
  const policiesSnap = await db.collection('policies')
    .where('status', '==', 'active')
    .get();

  const eligiblePolicies = policiesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => ELIGIBLE_PLANS.includes(p.planId));

  console.log(`  Found ${eligiblePolicies.length} eligible policies (Standard/Premium)`);

  if (eligiblePolicies.length === 0) {
    console.log('  No eligible policies found. Skipping payout.');
    return;
  }

  // 2. Fetch all downtime logs for this week
  const logsSnap = await db.collection('app_downtime_logs')
    .where('weekNumber', '==', weekNum)
    .where('isDown', '==', true)
    .get();

  const downtimeLogs = logsSnap.docs.map(d => d.data());
  console.log(`  Found ${downtimeLogs.length} downtime hours this week`);

  if (downtimeLogs.length === 0) {
    console.log('  No downtime recorded this week. No payouts needed.');
    return;
  }

  // 3. For each eligible policy, calculate payout
  const batch  = db.batch();
  let payoutsCreated = 0;

  for (const policy of eligiblePolicies) {
    const workerId = policy.workerId;

    // Fetch worker profile
    const workerSnap = await db.collection('workers').doc(workerId).get();
    if (!workerSnap.exists) continue;
    const worker = workerSnap.data();

    // Find downtime logs for this worker's app
    const workerAppLogs = downtimeLogs.filter(log => log.appId === worker.deliveryApp);
    if (workerAppLogs.length === 0) continue;

    // Filter logs that fall within the worker's shift hours
    const shiftDowntimeHours = workerAppLogs.filter(log =>
      isHourInShift(log.hour, worker.shiftPattern)
    );

    if (shiftDowntimeHours.length === 0) {
      console.log(`  Worker ${worker.name}: app was down but not during their shift. No payout.`);
      continue;
    }

    // Calculate payout
    const hoursDown    = shiftDowntimeHours.length;
    const rawPayout    = hoursDown * PAYOUT_PER_HOUR;
    const payoutAmount = Math.min(rawPayout, policy.coverageAmount);

    console.log(`  Worker ${worker.name} (${worker.shiftPattern} shift):`);
    console.log(`    App: ${worker.deliveryApp}`);
    console.log(`    Hours down during shift: ${hoursDown}`);
    console.log(`    Payout: ₹${payoutAmount} (${hoursDown} hrs × ₹${PAYOUT_PER_HOUR})`);

    // Check if we already created a payout for this worker this week
    const existingPayout = await db.collection('claims')
      .where('workerId', '==', workerId)
      .where('eventType', '==', 'app_outage')
      .where('autoTriggered', '==', true)
      .where('weekNumber', '==', weekNum)
      .get();

    if (!existingPayout.empty) {
      console.log(`    ⚠ Payout already exists for this worker this week. Skipping.`);
      continue;
    }

    // Create auto-approved claim
    const claimRef = db.collection('claims').doc();
    batch.set(claimRef, {
      workerId,
      policyId:       policy.id,
      eventType:      'app_outage',
      description:    `Auto-generated: ${worker.deliveryAppLabel || worker.deliveryApp} was down for ${hoursDown} hour(s) during your ${worker.shiftPattern} shift this week.`,
      estimatedLoss:  rawPayout,
      payoutAmount,
      aiScore:        100,
      aiReasons:      [
        `System verified: ${worker.deliveryApp} was down for ${hoursDown} hour(s)`,
        `Worker shift: ${worker.shiftPattern}`,
        `Payout: ${hoursDown} hrs × ₹${PAYOUT_PER_HOUR} = ₹${rawPayout}`,
        policy.coverageAmount < rawPayout
          ? `Capped at policy coverage: ₹${policy.coverageAmount}`
          : 'Within coverage limit',
      ],
      fraudFlag:      false,
      status:         'approved',
      reviewerNote:   `Auto-approved by GigGuard monitor. App downtime verified. ${hoursDown} hour(s) × ₹${PAYOUT_PER_HOUR}/hr.`,
      autoTriggered:  true,
      weekNumber:     weekNum,
      downtimeHours:  hoursDown,
      affectedApp:    worker.deliveryApp,
      reportedAt:     admin.firestore.Timestamp.now(),
      eventTimestamp: admin.firestore.Timestamp.now(),
      gradedAt:       admin.firestore.Timestamp.now(),
      evidenceRefs:   shiftDowntimeHours.map(l => `${l.appId}_${l.date}-${pad(l.hour)}`),
    });

    // Update worker totals
    const workerRef = db.collection('workers').doc(workerId);
    batch.update(workerRef, {
      totalClaims:  admin.firestore.FieldValue.increment(1),
      totalPaidOut: admin.firestore.FieldValue.increment(payoutAmount),
      updatedAt:    admin.firestore.Timestamp.now(),
    });

    payoutsCreated++;
  }

  await batch.commit();
  console.log(`\n  ✓ Weekly payout complete. ${payoutsCreated} claims auto-created.`);
}

// ─── HELPER: Get week number ──────────────────────────────────────────────────
function getWeekNumber(date) {
  const d    = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── HELPER: Get all dates in the current week (Mon–Sun) ─────────────────────
function getWeekDates(date) {
  const day    = date.getDay() || 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  });
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── SCHEDULE JOBS ───────────────────────────────────────────────────────────

// Every hour at :00 — ping all apps
cron.schedule('0 * * * *', async () => {
  try { await runHourlyPing(); }
  catch (err) { console.error('Hourly ping failed:', err); }
});

// Every Sunday at 11:59pm — run weekly payout
cron.schedule('59 23 * * 0', async () => {
  try { await runWeeklyPayout(); }
  catch (err) { console.error('Weekly payout failed:', err); }
});

// ─── STARTUP ─────────────────────────────────────────────────────────────────
console.log('🚀 GigGuard Monitor started');
console.log('   Hourly ping: every hour at :00');
console.log('   Weekly payout: every Sunday at 11:59pm');
console.log(`   Monitoring ${APPS.length} apps:`);
APPS.forEach(a => console.log(`   - ${a.label}: ${a.url}`));

// Run an immediate ping on startup so we don't wait a full hour
runHourlyPing().catch(console.error);
