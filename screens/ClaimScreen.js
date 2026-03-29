import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, TextInput
} from 'react-native';
import { db } from '../firebaseConfig';
import {
  collection, addDoc, query, where,
  getDocs, serverTimestamp
} from 'firebase/firestore';

const EVENT_TYPES = [
  { id: 'weather',     label: 'Heavy rain / extreme weather', icon: '🌧' },
  { id: 'app_outage',  label: 'Delivery app was down',        icon: '📵' },
  { id: 'network',     label: 'Internet / network outage',    icon: '📶' },
  { id: 'power',       label: 'City power outage',            icon: '⚡' },
  { id: 'social',      label: 'Curfew / strike / road block', icon: '🚧' },
];

export default function ClaimScreen({ route, navigation }) {
  const { userId } = route.params;
  const [activePolicy, setActivePolicy] = useState(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [eventType, setEventType] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedLoss, setEstimatedLoss] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchActivePolicy();
  }, []);

  const fetchActivePolicy = async () => {
    try {
      const now = new Date();
      const q = query(
        collection(db, 'policies'),
        where('workerId', '==', userId),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const policy = { id: snap.docs[0].id, ...snap.docs[0].data() };
        const weekEnd = policy.weekEnd.toDate();
        if (weekEnd >= now) {
          setActivePolicy(policy);
        }
      }
    } catch (e) {
      console.log(e.message);
    }
    setLoadingPolicy(false);
  };

  const handleSubmit = async () => {
    if (!eventType) {
      Alert.alert('Select the type of disruption');
      return;
    }
    if (!estimatedLoss || isNaN(estimatedLoss) || Number(estimatedLoss) <= 0) {
      Alert.alert('Enter a valid estimated loss amount');
      return;
    }
    if (!activePolicy.coveredEvents.includes(eventType)) {
      Alert.alert(
        'Not covered',
        `Your ${activePolicy.planName} plan does not cover this type of disruption.`
      );
      return;
    }
    if (Number(estimatedLoss) > activePolicy.coverageAmount) {
      Alert.alert(
        'Exceeds coverage',
        `Your plan covers up to ₹${activePolicy.coverageAmount}. Your claim will be capped at this amount.`
      );
    }

    Alert.alert(
      'Submit claim',
      `Submit a claim for ₹${estimatedLoss} due to ${eventType.replace('_', ' ')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit', onPress: async () => {
            setLoading(true);
            try {
              await addDoc(collection(db, 'claims'), {
                workerId: userId,
                policyId: activePolicy.id,
                eventType: eventType,
                description: description.trim(),
                estimatedLoss: Number(estimatedLoss),
                payoutAmount: 0,
                aiScore: null,
                fraudFlag: false,
                status: 'submitted',
                reportedAt: serverTimestamp(),
                eventTimestamp: serverTimestamp(),
                evidenceRefs: [],
                reviewerNote: '',
              });
              Alert.alert(
                'Claim submitted!',
                'Your claim is being reviewed. You will be notified of the outcome.',
                [{ text: 'OK', onPress: () => navigation.replace('Dashboard', { userId }) }]
              );
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setLoading(false);
          }
        }
      ]
    );
  };

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
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.replace('Policy', { userId })}
        >
          <Text style={styles.buttonText}>Buy a policy</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
            onPress={() => covered && setEventType(event.id)}
            disabled={!covered}
          >
            <Text style={styles.eventIcon}>{event.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[
                styles.eventLabel,
                !covered && styles.eventLabelDisabled
              ]}>
                {event.label}
              </Text>
              {!covered && (
                <Text style={styles.notCovered}>Not in your plan</Text>
              )}
            </View>
            {eventType === event.id && (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </TouchableOpacity>
        );
      })}

      <Text style={styles.label}>Estimated loss (₹)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 500"
        keyboardType="numeric"
        value={estimatedLoss}
        onChangeText={setEstimatedLoss}
      />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Briefly describe what happened..."
        multiline
        numberOfLines={3}
        value={description}
        onChangeText={setDescription}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Submit claim</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    backgroundColor: '#f5f5f5',
  },
  back: { marginBottom: 20 },
  backText: { fontSize: 15, color: '#2563eb' },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
  },
  policyBanner: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 24,
    borderWidth: 0.5,
    borderColor: '#bfdbfe',
  },
  policyBannerLabel: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: '600',
    marginBottom: 2,
  },
  policyBannerValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e40af',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 10,
    marginTop: 16,
  },
  eventCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  eventCardSelected: {
    borderColor: '#2563eb',
    borderWidth: 2,
    backgroundColor: '#eff6ff',
  },
  eventCardDisabled: {
    opacity: 0.4,
  },
  eventIcon: { fontSize: 20 },
  eventLabel: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  eventLabelDisabled: {
    color: '#9ca3af',
  },
  notCovered: {
    fontSize: 11,
    color: '#ef4444',
    marginTop: 2,
  },
  checkmark: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
  },
  textArea: {
    height: 90,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  noPolicy: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  noPolicySub: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 24,
  },
});