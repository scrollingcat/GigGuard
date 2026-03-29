import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert
} from 'react-native';
import { db } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 49,
    coverage: 800,
    color: '#6b7280',
    events: ['weather', 'app_outage'],
    description: 'Essential coverage for common disruptions',
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 79,
    coverage: 1500,
    color: '#2563eb',
    events: ['weather', 'app_outage', 'network', 'power'],
    description: 'Most popular — covers network and power too',
    recommended: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 129,
    coverage: 2500,
    color: '#7c3aed',
    events: ['weather', 'app_outage', 'network', 'power', 'social'],
    description: 'Full coverage including curfews and strikes',
  },
];

export default function PolicyScreen({ route, navigation }) {
  const { userId } = route.params;
  const [selected, setSelected] = useState('standard');
  const [loading, setLoading] = useState(false);

  const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { weekStart: monday, weekEnd: sunday };
  };

  const handlePurchase = async () => {
    const plan = PLANS.find(p => p.id === selected);
    Alert.alert(
      'Confirm purchase',
      `Buy ${plan.name} plan for ₹${plan.price} this week?\nCoverage up to ₹${plan.coverage}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm', onPress: async () => {
            setLoading(true);
            try {
              const { weekStart, weekEnd } = getWeekRange();
              await addDoc(collection(db, 'policies'), {
                workerId: userId,
                planId: plan.id,
                planName: plan.name,
                premiumPaid: plan.price,
                coverageAmount: plan.coverage,
                coveredEvents: plan.events,
                weekStart: weekStart,
                weekEnd: weekEnd,
                status: 'active',
                createdAt: serverTimestamp(),
              });
              Alert.alert(
                'Policy activated!',
                `You are covered up to ₹${plan.coverage} this week.`,
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Choose a plan</Text>
      <Text style={styles.subtitle}>Coverage resets every Monday</Text>

      {PLANS.map(plan => (
        <TouchableOpacity
          key={plan.id}
          style={[
            styles.card,
            selected === plan.id && { borderColor: plan.color, borderWidth: 2 }
          ]}
          onPress={() => setSelected(plan.id)}
        >
          {plan.recommended && (
            <View style={[styles.badge, { backgroundColor: plan.color }]}>
              <Text style={styles.badgeText}>Most popular</Text>
            </View>
          )}

          <View style={styles.cardHeader}>
            <Text style={[styles.planName, { color: plan.color }]}>{plan.name}</Text>
            <View>
              <Text style={styles.price}>₹{plan.price}<Text style={styles.perWeek}>/week</Text></Text>
            </View>
          </View>

          <Text style={styles.coverage}>Up to ₹{plan.coverage} coverage</Text>
          <Text style={styles.description}>{plan.description}</Text>

          <View style={styles.eventRow}>
            {plan.events.map(e => (
              <View key={e} style={styles.eventChip}>
                <Text style={styles.eventText}>{e.replace('_', ' ')}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        style={styles.button}
        onPress={handlePurchase}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>
              Buy {PLANS.find(p => p.id === selected)?.name} plan —
              ₹{PLANS.find(p => p.id === selected)?.price}
            </Text>
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
  back: {
    marginBottom: 20,
  },
  backText: {
    fontSize: 15,
    color: '#2563eb',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    marginBottom: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
  },
  price: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  perWeek: {
    fontSize: 13,
    fontWeight: '400',
    color: '#888',
  },
  coverage: {
    fontSize: 13,
    color: '#444',
    marginBottom: 4,
    fontWeight: '500',
  },
  description: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
  },
  eventRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  eventChip: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  eventText: {
    fontSize: 11,
    color: '#6b7280',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});