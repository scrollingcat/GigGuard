import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  ScrollView
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function RegisterScreen({ route, navigation }) {
  const { userId, phone } = route.params;

  const [name, setName] = useState('');
  const [deliveryApp, setDeliveryApp] = useState('');
  const [zones, setZones] = useState('');
  const [shiftPattern, setShiftPattern] = useState('');
  const [upiId, setUpiId] = useState('');
  const [loading, setLoading] = useState(false);

  const apps = ['zepto', 'blinkit', 'swiggy', 'dunzo', 'zomato'];
  const shifts = ['morning', 'afternoon', 'evening', 'night'];

  const handleRegister = async () => {
    if (!name || !deliveryApp || !zones || !shiftPattern || !upiId) {
      Alert.alert('Please fill all fields');
      return;
    }
    const zonesArray = zones.split(',').map(z => z.trim());
    const badZone = zonesArray.find(z => !/^\d{6}$/.test(z));
    if (badZone) {
      Alert.alert('Invalid pincode', `"${badZone}" is not a valid 6-digit pincode`);
      return;
    }
    setLoading(true);
    try {
      await setDoc(doc(db, 'workers', userId), {
        uid: userId,
        phone: phone,
        name: name.trim(),
        deliveryApp: deliveryApp,
        zones: zonesArray,
        shiftPattern: shiftPattern,
        upiId: upiId.trim().toLowerCase(),
        kycStatus: 'pending',
        avgWeeklyEarnings: 0,
        riskScore: 50,
        totalClaims: 0,
        totalPaidOut: 0,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigation.replace('Dashboard', { userId });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setLoading(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create Profile</Text>
      <Text style={styles.subtitle}>Tell us about yourself</Text>

      <Text style={styles.label}>Full name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Ravi Kumar"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Delivery app</Text>
      <View style={styles.chipRow}>
        {apps.map(app => (
          <TouchableOpacity
            key={app}
            style={[styles.chip, deliveryApp === app && styles.chipSelected]}
            onPress={() => setDeliveryApp(app)}
          >
            <Text style={[styles.chipText, deliveryApp === app && styles.chipTextSelected]}>
              {app}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Delivery pincodes</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 122001, 122018"
        value={zones}
        onChangeText={setZones}
        keyboardType="numeric"
      />
      <Text style={styles.hint}>Separate multiple pincodes with commas</Text>

      <Text style={styles.label}>Shift pattern</Text>
      <View style={styles.chipRow}>
        {shifts.map(shift => (
          <TouchableOpacity
            key={shift}
            style={[styles.chip, shiftPattern === shift && styles.chipSelected]}
            onPress={() => setShiftPattern(shift)}
          >
            <Text style={[styles.chipText, shiftPattern === shift && styles.chipTextSelected]}>
              {shift}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>UPI ID</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. ravi@okaxis"
        value={upiId}
        onChangeText={setUpiId}
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleRegister}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Create account</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#888',
    marginBottom: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  hint: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  chipSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    fontSize: 13,
    color: '#666',
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});