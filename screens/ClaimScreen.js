import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, TextInput, Modal
} from 'react-native';
import * as Location from 'expo-location';
import { db } from '../firebaseConfig';
import {
  collection, addDoc, updateDoc, query, where,
  getDocs, doc, getDoc, serverTimestamp
} from 'firebase/firestore';

const OPENWEATHER_API_KEY = '69fb4fdfcd9a514a85570ce51ec1f3d9';

const EVENT_TYPES = [
  { id: 'weather',    label: 'Extreme weather',              icon: '🌧' },
  { id: 'app_outage', label: 'Delivery app was down',        icon: '📵' },
  { id: 'network',    label: 'Internet / network outage',    icon: '📶' },
  { id: 'power',      label: 'City power outage',            icon: '⚡' },
  { id: 'social',     label: 'Curfew / strike / road block', icon: '🚧' },
];

const WEATHER_SUBTYPES = [
  { id: 'heavy_rain',       label: 'Heavy Rain',       icon: '🌧' },
  { id: 'extreme_heatwave', label: 'Extreme Heatwave', icon: '🌡' },
  { id: 'hailstorm',        label: 'Hailstorm',        icon: '🌨' },
];

// ─── Fetch live weather for a pincode ────────────────────────────────────────
async function fetchWeather(pincode) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?zip=${pincode},IN&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.cod !== 200) return null;

    const weatherCode = data.weather[0].id;
    const rain        = data.rain?.['1h'] || data.rain?.['3h'] || 0;
    const windSpeed   = data.wind?.speed || 0;
    const description = data.weather[0].description;

    let severity = 'clear';
    if (weatherCode >= 200 && weatherCode < 300) severity = 'extreme';
    else if (weatherCode >= 300 && weatherCode < 400) severity = 'moderate';
    else if (weatherCode >= 500 && weatherCode < 600) severity = rain > 10 ? 'extreme' : 'moderate';
    else if (weatherCode >= 700 && weatherCode < 800) severity = 'moderate';
    else if (weatherCode === 800) severity = 'clear';
    else if (weatherCode > 800)   severity = 'low';

    return { weatherCode, rain, windSpeed, description, severity };
  } catch {
    return null;
  }
}

// ─── AI Scoring Logic ─────────────────────────────────────────────────────────
function calculateAiScore({ eventType, weather, workerShift, recentClaimsCount, estimatedLoss, coverageAmount }) {
  let score   = 50;
  let reasons = [];

  if (eventType === 'weather') {
    if (!weather) {
      score -= 10; reasons.push('Could not verify weather data');
    } else if (weather.severity === 'extreme') {
      score += 35; reasons.push(`Severe weather confirmed: ${weather.description}`);
    } else if (weather.severity === 'moderate') {
      score += 20; reasons.push(`Adverse weather confirmed: ${weather.description}`);
    } else if (weather.severity === 'low') {
      score -= 10; reasons.push('Mild weather — low disruption likelihood');
    } else {
      score -= 25; reasons.push('Clear skies detected — weather claim unlikely');
    }
  }

  if (eventType === 'app_outage') { score += 15; reasons.push('App outage — plausible'); }
  if (eventType === 'network')    { score += 10; reasons.push('Network outage — moderate plausibility'); }
  if (eventType === 'power')      { score += 10; reasons.push('Power outage — moderate plausibility'); }
  if (eventType === 'social')     { score += 12; reasons.push('Civil disruption — moderate plausibility'); }

  const hour = new Date().getHours();
  const shiftMap = { morning: [6,12], afternoon: [12,17], evening: [17,21], night: [21,6] };
  const [s, e]   = shiftMap[workerShift] || [0, 24];
  const inShift  = workerShift === 'night' ? (hour >= s || hour < e) : (hour >= s && hour < e);
  if (inShift) { score += 10; reasons.push("Claim filed during worker's usual shift"); }
  else         { score -= 5;  reasons.push("Claim filed outside worker's usual shift"); }

  if (recentClaimsCount >= 3)      { score -= 20; reasons.push(`High claim frequency: ${recentClaimsCount} claims this week`); }
  else if (recentClaimsCount >= 2) { score -= 8;  reasons.push('Multiple claims this week'); }

  const fraction = estimatedLoss / coverageAmount;
  if (fraction > 0.95)     { score -= 10; reasons.push('Claimed amount near coverage ceiling'); }
  else if (fraction < 0.3) { score += 5;  reasons.push('Conservative claim amount — credible'); }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ClaimScreen({ route, navigation }) {
  const { userId } = route.params;

  const [activePolicy, setActivePolicy]       = useState(null);
  const [loadingPolicy, setLoadingPolicy]     = useState(true);
  const [eventType, setEventType]             = useState('');
  const [weatherSubtype, setWeatherSubtype]   = useState('');
  const [weatherDropdownOpen, setWeatherDropdownOpen] = useState(false);
  const [location, setLocation]               = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [description, setDescription]         = useState('');
  const [estimatedLoss, setEstimatedLoss]     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [loadingStatus, setLoadingStatus]     = useState('');

  useEffect(() => { fetchActivePolicy(); }, []);

  const fetchActivePolicy = async () => {
    try {
      const now = new Date();
      const q   = query(
        collection(db, 'policies'),
        where('workerId', '==', userId),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const policy = { id: snap.docs[0].id, ...snap.docs[0].data() };
        if (policy.weekEnd.toDate() >= now) setActivePolicy(policy);
      }
    } catch (e) { console.log(e.message); }
    setLoadingPolicy(false);
  };

  // ─── Handle event type selection ───────────────────────────────────────────
  const handleEventTypeSelect = (id) => {
    setEventType(id);
    // Reset weather subtype and location when switching away from weather
    if (id !== 'weather') {
      setWeatherSubtype('');
      setLocation(null);
    }
  };

  // ─── Handle weather subtype selection → request location ───────────────────
  const handleWeatherSubtypeSelect = async (subtypeId) => {
    setWeatherSubtype(subtypeId);
    setWeatherDropdownOpen(false);
    await requestLocation();
  };

  // ─── Request location permission and get coords ────────────────────────────
  const requestLocation = async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location required',
          'Location is needed to verify your weather claim. Please enable it in settings.',
          [{ text: 'OK' }]
        );
        setLocationLoading(false);
        return;
      }
      const coords = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocation({
        latitude:  coords.coords.latitude,
        longitude: coords.coords.longitude,
        accuracy:  coords.coords.accuracy,
      });
    } catch (e) {
      Alert.alert('Location error', 'Could not get your location. You can still submit the claim.');
    }
    setLocationLoading(false);
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!eventType) { Alert.alert('Select the type of disruption'); return; }
    if (eventType === 'weather' && !weatherSubtype) {
      Alert.alert('Select weather type', 'Please select the type of weather disruption.');
      return;
    }
    if (!estimatedLoss || isNaN(estimatedLoss) || Number(estimatedLoss) <= 0) {
      Alert.alert('Enter a valid estimated loss amount'); return;
    }
    if (!activePolicy.coveredEvents.includes(eventType)) {
      Alert.alert('Not covered', `Your ${activePolicy.planName} plan does not cover this type of disruption.`);
      return;
    }

    const selectedSubtype = WEATHER_SUBTYPES.find(s => s.id === weatherSubtype);
    const displayType = eventType === 'weather' && selectedSubtype
      ? selectedSubtype.label
      : eventType.replace('_', ' ');

    Alert.alert(
      'Submit claim',
      `Submit a claim for ₹${estimatedLoss} due to ${displayType}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit', onPress: async () => {
            setLoading(true);
            try {
              const claimTimestamp = new Date();

              // Step 1: Save to manual_claims collection (weather claims with location)
              if (eventType === 'weather') {
                setLoadingStatus('Saving claim location...');
                await addDoc(collection(db, 'manual_claims'), {
                  workerId:        userId,
                  policyId:        activePolicy.id,
                  eventType:       'weather',
                  weatherSubtype:  weatherSubtype,
                  weatherLabel:    selectedSubtype?.label || weatherSubtype,
                  location:        location ? {
                    latitude:  location.latitude,
                    longitude: location.longitude,
                    accuracy:  location.accuracy,
                  } : null,
                  locationCaptured: location !== null,
                  estimatedLoss:   Number(estimatedLoss),
                  description:     description.trim(),
                  filedAt:         claimTimestamp.toISOString(),
                  reportedAt:      serverTimestamp(),
                });
              }

              // Step 2: Save claim to claims collection
              setLoadingStatus('Submitting claim...');
              const claimRef = await addDoc(collection(db, 'claims'), {
                workerId:       userId,
                policyId:       activePolicy.id,
                eventType:      eventType,
                weatherSubtype: eventType === 'weather' ? weatherSubtype : null,
                description:    description.trim(),
                estimatedLoss:  Number(estimatedLoss),
                payoutAmount:   0,
                aiScore:        null,
                fraudFlag:      false,
                status:         'submitted',
                location:       location || null,
                reportedAt:     serverTimestamp(),
                eventTimestamp: serverTimestamp(),
                evidenceRefs:   [],
                reviewerNote:   '',
              });

              // Step 3: Fetch worker profile
              setLoadingStatus('Fetching worker profile...');
              const workerSnap = await getDoc(doc(db, 'workers', userId));
              const worker     = workerSnap.data();
              const primaryPincode = worker?.zones?.[0];

              // Step 4: Fetch live weather
              setLoadingStatus('Checking weather data...');
              const weather = primaryPincode ? await fetchWeather(primaryPincode) : null;

              // Step 5: Count recent claims (fraud check)
              setLoadingStatus('Running AI analysis...');
              const recentSnap = await getDocs(
                query(collection(db, 'claims'), where('workerId', '==', userId))
              );
              const recentClaimsCount = Math.max(0, recentSnap.size - 1);

              // Step 6: Calculate AI score
              const { score, reasons } = calculateAiScore({
                eventType,
                weather,
                workerShift:    worker?.shiftPattern,
                recentClaimsCount,
                estimatedLoss:  Number(estimatedLoss),
                coverageAmount: activePolicy.coverageAmount,
              });

              // Step 7: Determine outcome
              let status, payoutAmount, reviewerNote;
              if (score >= 65) {
                status       = 'approved';
                payoutAmount = Math.min(Number(estimatedLoss), activePolicy.coverageAmount);
                reviewerNote = `Auto-approved. AI confidence: ${score}%. ${reasons[0]}.`;
              } else if (score >= 40) {
                status       = 'under_review';
                payoutAmount = 0;
                reviewerNote = `Flagged for review. AI confidence: ${score}%. ${reasons.join(' ')}`;
              } else {
                status       = 'rejected';
                payoutAmount = 0;
                reviewerNote = `Auto-rejected. AI confidence: ${score}%. ${reasons.join(' ')}`;
              }

              // Step 8: Update claim with AI result
              setLoadingStatus('Updating claim status...');
              await updateDoc(doc(db, 'claims', claimRef.id), {
                aiScore:      score,
                aiReasons:    reasons,
                status,
                payoutAmount,
                reviewerNote,
                weatherAtClaim: weather ? {
                  description: weather.description,
                  severity:    weather.severity,
                  rain:        weather.rain,
                  windSpeed:   weather.windSpeed,
                } : null,
                gradedAt: serverTimestamp(),
              });

              // Step 9: Show result
              const icon    = status === 'approved' ? '✅' : status === 'rejected' ? '❌' : '🔍';
              const message = status === 'approved'
                ? `Your claim has been approved!\nPayout: ₹${payoutAmount}\n\nAI confidence: ${score}%\n${reasons[0]}`
                : status === 'under_review'
                ? `Your claim is under review.\n\nAI confidence: ${score}%\n${reasons[0]}`
                : `Your claim was not approved.\n\nAI confidence: ${score}%\n${reasons[0]}`;

              Alert.alert(
                `${icon} Claim ${status.replace('_', ' ')}`,
                message,
                [{ text: 'OK', onPress: () => navigation.replace('Dashboard', { userId }) }]
              );

            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setLoading(false);
            setLoadingStatus('');
          }
        }
      ]
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loadingPolicy) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!activePolicy) {
    return (
      <View style={styles.centered}>
        <Text style={styles.noPolicy}>No active policy</Text>
        <Text style={styles.noPolicySub}>You need an active policy to file a claim.</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.replace('Policy', { userId })}>
          <Text style={styles.buttonText}>Buy a policy</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const selectedSubtype = WEATHER_SUBTYPES.find(s => s.id === weatherSubtype);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>File a claim</Text>
      <Text style={styles.subtitle}>Tell us what happened</Text>

      <View style={styles.policyBanner}>
        <Text style={styles.policyBannerLabel}>Active plan</Text>
        <Text style={styles.policyBannerValue}>
          {activePolicy.planName} — up to ₹{activePolicy.coverageAmount}
        </Text>
      </View>

      {/* Event type selection */}
      <Text style={styles.label}>What disruption happened?</Text>
      {EVENT_TYPES.map(event => {
        const covered = activePolicy.coveredEvents.includes(event.id);
        return (
          <TouchableOpacity
            key={event.id}
            style={[
              styles.eventCard,
              eventType === event.id && styles.eventCardSelected,
              !covered && styles.eventCardDisabled,
            ]}
            onPress={() => covered && handleEventTypeSelect(event.id)}
            disabled={!covered}
          >
            <Text style={styles.eventIcon}>{event.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eventLabel, !covered && styles.eventLabelDisabled]}>
                {event.label}
              </Text>
              {!covered && <Text style={styles.notCovered}>Not in your plan</Text>}
            </View>
            {eventType === event.id && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        );
      })}

      {/* Weather subtype dropdown — only shown when weather is selected */}
      {eventType === 'weather' && (
        <View style={styles.weatherSection}>
          <Text style={styles.label}>Type of weather event</Text>
          <TouchableOpacity
            style={[styles.dropdown, weatherSubtype && styles.dropdownFilled]}
            onPress={() => setWeatherDropdownOpen(true)}
          >
            {selectedSubtype ? (
              <View style={styles.dropdownSelected}>
                <Text style={styles.dropdownIcon}>{selectedSubtype.icon}</Text>
                <Text style={styles.dropdownSelectedText}>{selectedSubtype.label}</Text>
              </View>
            ) : (
              <Text style={styles.dropdownPlaceholder}>Select weather type</Text>
            )}
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>

          {/* Location status */}
          {weatherSubtype && (
            <View style={styles.locationRow}>
              {locationLoading ? (
                <>
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text style={styles.locationText}>Getting your location...</Text>
                </>
              ) : location ? (
                <>
                  <Text style={styles.locationIcon}>📍</Text>
                  <Text style={styles.locationTextSuccess}>
                    Location captured ({location.latitude.toFixed(4)}, {location.longitude.toFixed(4)})
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.locationIcon}>⚠️</Text>
                  <Text style={styles.locationTextWarn}>Location not captured</Text>
                  <TouchableOpacity onPress={requestLocation} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      )}

      {/* Weather subtype modal */}
      <Modal
        visible={weatherDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWeatherDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setWeatherDropdownOpen(false)}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select weather type</Text>
            {WEATHER_SUBTYPES.map(sub => (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.modalOption,
                  weatherSubtype === sub.id && styles.modalOptionSelected
                ]}
                onPress={() => handleWeatherSubtypeSelect(sub.id)}
              >
                <Text style={styles.modalOptionIcon}>{sub.icon}</Text>
                <Text style={[
                  styles.modalOptionText,
                  weatherSubtype === sub.id && styles.modalOptionTextSelected
                ]}>
                  {sub.label}
                </Text>
                {weatherSubtype === sub.id && (
                  <Text style={styles.modalCheckmark}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
            <Text style={styles.modalNote}>
              📍 Your location will be captured after selection
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Estimated loss */}
      <Text style={styles.label}>Estimated loss (₹)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 500"
        keyboardType="numeric"
        value={estimatedLoss}
        onChangeText={setEstimatedLoss}
      />

      {/* Description */}
      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Briefly describe what happened..."
        multiline
        numberOfLines={3}
        value={description}
        onChangeText={setDescription}
      />

      {/* Submit button */}
      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingText}>{loadingStatus}</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Submit claim</Text>
        )}
      </TouchableOpacity>

      {loading && (
        <View style={styles.aiBox}>
          <Text style={styles.aiBoxText}>🤖 AI is analysing your claim...</Text>
          <Text style={styles.aiBoxSub}>{loadingStatus}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:  { backgroundColor: '#f5f5f5', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: '#f5f5f5' },
  back:       { marginBottom: 20 },
  backText:   { fontSize: 15, color: '#2563eb' },
  title:      { fontSize: 26, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  subtitle:   { fontSize: 14, color: '#888', marginBottom: 20 },
  policyBanner: {
    backgroundColor: '#eff6ff', borderRadius: 10, padding: 14,
    marginBottom: 24, borderWidth: 0.5, borderColor: '#bfdbfe',
  },
  policyBannerLabel: { fontSize: 12, color: '#3b82f6', fontWeight: '600', marginBottom: 2 },
  policyBannerValue: { fontSize: 15, fontWeight: '600', color: '#1e40af' },
  label:      { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 10, marginTop: 16 },
  eventCard:  {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 0.5, borderColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  eventCardSelected:  { borderColor: '#2563eb', borderWidth: 2, backgroundColor: '#eff6ff' },
  eventCardDisabled:  { opacity: 0.4 },
  eventIcon:          { fontSize: 20 },
  eventLabel:         { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  eventLabelDisabled: { color: '#9ca3af' },
  notCovered:         { fontSize: 11, color: '#ef4444', marginTop: 2 },
  checkmark:          { fontSize: 16, color: '#2563eb', fontWeight: '700' },

  // Weather section
  weatherSection: {
    backgroundColor: '#f0fdf4', borderRadius: 10, padding: 14,
    marginTop: 8, borderWidth: 0.5, borderColor: '#bbf7d0',
  },

  // Dropdown
  dropdown: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    padding: 14, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dropdownFilled:       { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  dropdownPlaceholder:  { fontSize: 14, color: '#aaa', flex: 1 },
  dropdownSelected:     { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dropdownIcon:         { fontSize: 18 },
  dropdownSelectedText: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  dropdownArrow:        { fontSize: 11, color: '#888' },

  // Location row
  locationRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  locationIcon:       { fontSize: 14 },
  locationText:       { fontSize: 12, color: '#3b82f6' },
  locationTextSuccess:{ fontSize: 12, color: '#16a34a', flex: 1 },
  locationTextWarn:   { fontSize: 12, color: '#d97706', flex: 1 },
  retryBtn:           { backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  retryText:          { fontSize: 11, color: '#92400e', fontWeight: '600' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  modalBox:     { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%' },
  modalTitle:   { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 16 },
  modalOption:  {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4,
  },
  modalOptionSelected:     { backgroundColor: '#eff6ff' },
  modalOptionIcon:         { fontSize: 22 },
  modalOptionText:         { fontSize: 15, color: '#1a1a1a', flex: 1 },
  modalOptionTextSelected: { color: '#2563eb', fontWeight: '600' },
  modalCheckmark:          { fontSize: 16, color: '#2563eb', fontWeight: '700' },
  modalNote:    { fontSize: 11, color: '#888', textAlign: 'center', marginTop: 12 },

  // Input
  input:       { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 14, fontSize: 15 },
  textArea:    { height: 90, textAlignVertical: 'top' },
  button:      { backgroundColor: '#2563eb', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  buttonText:  { color: '#fff', fontSize: 15, fontWeight: '600' },
  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: '#fff', fontSize: 13 },
  aiBox: {
    marginTop: 16, backgroundColor: '#eff6ff', borderRadius: 10,
    padding: 14, borderWidth: 0.5, borderColor: '#bfdbfe', alignItems: 'center',
  },
  aiBoxText:   { fontSize: 14, fontWeight: '600', color: '#1e40af', marginBottom: 4 },
  aiBoxSub:    { fontSize: 12, color: '#3b82f6' },
  noPolicy:    { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  noPolicySub: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
});