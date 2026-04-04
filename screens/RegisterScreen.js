import { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  ScrollView, Modal, FlatList
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const APPS = [
  { id: 'swiggy_instamart', label: 'Swiggy Instamart', icon: '🛒' },
  { id: 'zepto',            label: 'Zepto',            icon: '⚡' },
  { id: 'blinkit',          label: 'Blinkit',          icon: '🟡' },
  { id: 'flipkart_minutes', label: 'Flipkart Minutes', icon: '📦' },
  { id: 'instablink',       label: 'Instablink',       icon: '🔵', note: 'Test app' },
];

const SHIFTS = ['morning', 'afternoon', 'evening', 'night'];

export default function RegisterScreen({ route, navigation }) {
  const { userId, phone } = route.params;

  const [name, setName]               = useState('');
  const [deliveryApp, setDeliveryApp] = useState('');
  const [zones, setZones]             = useState('');
  const [shiftPattern, setShiftPattern] = useState('');
  const [upiId, setUpiId]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const selectedApp = APPS.find(a => a.id === deliveryApp);

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
        uid:              userId,
        phone:            phone,
        name:             name.trim(),
        deliveryApp:      deliveryApp,
        deliveryAppLabel: selectedApp?.label || deliveryApp,
        zones:            zonesArray,
        shiftPattern:     shiftPattern,
        upiId:            upiId.trim().toLowerCase(),
        kycStatus:        'pending',
        avgWeeklyEarnings: 0,
        riskScore:        50,
        totalClaims:      0,
        totalPaidOut:     0,
        premiumModifier:  1.0,
        isActive:         true,
        createdAt:        serverTimestamp(),
        updatedAt:        serverTimestamp(),
      });

      await AsyncStorage.setItem('userId', userId);
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

      {/* Full name */}
      <Text style={styles.label}>Full name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Ravi Kumar"
        value={name}
        onChangeText={setName}
      />

      {/* Delivery app dropdown */}
      <Text style={styles.label}>Delivery app</Text>
      <TouchableOpacity
        style={[styles.dropdown, dropdownOpen && styles.dropdownOpen]}
        onPress={() => setDropdownOpen(true)}
      >
        {selectedApp ? (
          <View style={styles.dropdownSelected}>
            <Text style={styles.dropdownIcon}>{selectedApp.icon}</Text>
            <Text style={styles.dropdownSelectedText}>{selectedApp.label}</Text>
            {selectedApp.note && (
              <View style={styles.testBadge}>
                <Text style={styles.testBadgeText}>{selectedApp.note}</Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.dropdownPlaceholder}>Select your delivery app</Text>
        )}
        <Text style={styles.dropdownArrow}>▼</Text>
      </TouchableOpacity>

      {/* Dropdown Modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select delivery app</Text>
            {APPS.map(app => (
              <TouchableOpacity
                key={app.id}
                style={[
                  styles.modalOption,
                  deliveryApp === app.id && styles.modalOptionSelected
                ]}
                onPress={() => {
                  setDeliveryApp(app.id);
                  setDropdownOpen(false);
                }}
              >
                <Text style={styles.modalOptionIcon}>{app.icon}</Text>
                <Text style={[
                  styles.modalOptionText,
                  deliveryApp === app.id && styles.modalOptionTextSelected
                ]}>
                  {app.label}
                </Text>
                {app.note && (
                  <View style={styles.testBadge}>
                    <Text style={styles.testBadgeText}>{app.note}</Text>
                  </View>
                )}
                {deliveryApp === app.id && (
                  <Text style={styles.modalCheckmark}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Pincodes */}
      <Text style={styles.label}>Delivery pincodes</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 122001, 122018"
        value={zones}
        onChangeText={setZones}
        keyboardType="numeric"
      />
      <Text style={styles.hint}>Separate multiple pincodes with commas</Text>

      {/* Shift pattern */}
      <Text style={styles.label}>Shift pattern</Text>
      <View style={styles.chipRow}>
        {SHIFTS.map(shift => (
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

      {/* UPI ID */}
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
  container:   { backgroundColor: '#fff', paddingHorizontal: 28, paddingTop: 60, paddingBottom: 40 },
  title:       { fontSize: 28, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  subtitle:    { fontSize: 15, color: '#888', marginBottom: 32 },
  label:       { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 8, marginTop: 16 },
  input:       { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 15, backgroundColor: '#fafafa' },
  hint:        { fontSize: 12, color: '#aaa', marginTop: 4 },

  // Dropdown
  dropdown: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    padding: 14, backgroundColor: '#fafafa',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dropdownOpen:        { borderColor: '#2563eb' },
  dropdownPlaceholder: { fontSize: 15, color: '#aaa', flex: 1 },
  dropdownSelected:    { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dropdownIcon:        { fontSize: 18 },
  dropdownSelectedText:{ fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  dropdownArrow:       { fontSize: 11, color: '#888' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 20, width: '100%',
  },
  modalTitle:    { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 16 },
  modalOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 10, marginBottom: 4,
  },
  modalOptionSelected:     { backgroundColor: '#eff6ff' },
  modalOptionIcon:         { fontSize: 20 },
  modalOptionText:         { fontSize: 15, color: '#1a1a1a', flex: 1 },
  modalOptionTextSelected: { color: '#2563eb', fontWeight: '600' },
  modalCheckmark:          { fontSize: 16, color: '#2563eb', fontWeight: '700' },

  // Test badge
  testBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  testBadgeText: { fontSize: 10, color: '#92400e', fontWeight: '600' },

  // Chips (shift pattern)
  chipRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:            { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fafafa' },
  chipSelected:    { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText:        { fontSize: 13, color: '#666' },
  chipTextSelected:{ color: '#fff', fontWeight: '600' },

  button:     { backgroundColor: '#2563eb', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});