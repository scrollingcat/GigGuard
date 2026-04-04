import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, Alert
} from 'react-native';
import { db } from '../firebaseConfig';
import {
  doc, getDoc, collection, query,
  where, getDocs, orderBy, deleteDoc
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STATUS_COLORS = {
  submitted:    { bg: '#fef9c3', text: '#854d0e' },
  under_review: { bg: '#fef3c7', text: '#92400e' },
  approved:     { bg: '#dcfce7', text: '#166534' },
  rejected:     { bg: '#fee2e2', text: '#991b1b' },
  paid:         { bg: '#d1fae5', text: '#065f46' },
};

const POLICY_COLORS = {
  basic:    '#6b7280',
  standard: '#2563eb',
  premium:  '#7c3aed',
};

export default function DashboardScreen({ route, navigation }) {
  const { userId } = route.params;

  const [worker, setWorker]           = useState(null);
  const [activePolicy, setActivePolicy] = useState(null);
  const [claims, setClaims]           = useState([]);
  const [policies, setPolicies]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [tab, setTab]                 = useState('overview');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      await Promise.all([
        fetchWorker(),
        fetchPolicies(),
        fetchClaims(),
      ]);
    } catch (e) {
      console.log(e.message);
    }
    setLoading(false);
    setRefreshing(false);
  };

  const fetchWorker = async () => {
    const snap = await getDoc(doc(db, 'workers', userId));
    if (snap.exists()) setWorker(snap.data());
  };

  const fetchPolicies = async () => {
    const now = new Date();
    const q = query(
      collection(db, 'policies'),
      where('workerId', '==', userId),
    );
    const snap = await getDocs(q);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
    setPolicies(all);
    const active = all.find(p =>
      p.status === 'active' && p.weekEnd?.toDate() >= now
    );
    setActivePolicy(active || null);
  };

  const fetchClaims = async () => {
    const q = query(
      collection(db, 'claims'),
      where('workerId', '==', userId),
    );
    const snap = await getDocs(q);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => b.reportedAt?.seconds - a.reportedAt?.seconds);
    setClaims(all);
  };

  const handleDeletePolicy = (policyId) => {
    Alert.alert(
      'Delete policy',
      'Are you sure you want to delete this policy? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deleteDoc(doc(db, 'policies', policyId));
              setPolicies(prev => prev.filter(p => p.id !== policyId));
              // Refresh active policy
              const now = new Date();
              setPolicies(prev => {
                const remaining = prev.filter(p => p.id !== policyId);
                const active = remaining.find(p => p.status === 'active' && p.weekEnd?.toDate() >= now);
                setActivePolicy(active || null);
                return remaining;
              });
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  };

  const handleDeleteClaim = (claimId) => {
    Alert.alert(
      'Delete claim',
      'Are you sure you want to delete this claim? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deleteDoc(doc(db, 'claims', claimId));
              setClaims(prev => prev.filter(c => c.id !== claimId));
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('userId');
    navigation.replace('Login');
  };

  const formatDate = (ts) => {
    if (!ts) return '—';
    const d = ts.toDate();
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const totalPaidOut = claims
    .filter(c => c.status === 'approved' || c.status === 'paid')
    .reduce((sum, c) => sum + (c.payoutAmount || 0), 0);

  const totalPremiums = policies
    .reduce((sum, p) => sum + (p.premiumPaid || 0), 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Hello, {worker?.name?.split(' ')[0] || 'there'}
          </Text>
          <Text style={styles.headerSub}>
            {worker?.deliveryApp} · {worker?.kycStatus === 'verified' ? 'KYC verified' : 'KYC pending'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logout}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['overview', 'claims', 'policies'].map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => {
            setRefreshing(true);
            fetchAll();
          }} />
        }
      >

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <>
            {/* Active policy card */}
            {activePolicy ? (
              <View style={[styles.policyCard, { borderLeftColor: POLICY_COLORS[activePolicy.planId] }]}>
                <Text style={styles.policyCardLabel}>Active policy this week</Text>
                <Text style={[styles.policyCardName, { color: POLICY_COLORS[activePolicy.planId] }]}>
                  {activePolicy.planName} plan
                </Text>
                <Text style={styles.policyCardCoverage}>
                  Coverage up to ₹{activePolicy.coverageAmount}
                </Text>
                <Text style={styles.policyCardDates}>
                  {formatDate(activePolicy.weekStart)} — {formatDate(activePolicy.weekEnd)}
                </Text>
                <View style={styles.eventChipRow}>
                  {activePolicy.coveredEvents?.map(e => (
                    <View key={e} style={styles.eventChip}>
                      <Text style={styles.eventChipText}>{e.replace('_', ' ')}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.noPolicyCard}>
                <Text style={styles.noPolicyTitle}>No active policy</Text>
                <Text style={styles.noPolicySub}>Buy a plan to get covered this week</Text>
                <TouchableOpacity
                  style={styles.buyButton}
                  onPress={() => navigation.navigate('Policy', { userId })}
                >
                  <Text style={styles.buyButtonText}>Buy a policy</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Premium modifier indicator */}
            {(worker?.premiumModifier || 1.0) > 1.0 && (
              <View style={styles.modifierCard}>
                <Text style={styles.modifierLabel}>Premium modifier</Text>
                <Text style={styles.modifierValue}>
                  {(worker.premiumModifier).toFixed(2)}x
                </Text>
                <Text style={styles.modifierHint}>
                  Your plan prices are adjusted due to recent platform activity
                </Text>
              </View>
            )}

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{claims.length}</Text>
                <Text style={styles.statLabel}>Total claims</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>₹{totalPaidOut}</Text>
                <Text style={styles.statLabel}>Total paid out</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>₹{totalPremiums}</Text>
                <Text style={styles.statLabel}>Premiums paid</Text>
              </View>
            </View>

            {/* Recent claims */}
            <Text style={styles.sectionTitle}>Recent claims</Text>
            {claims.length === 0 ? (
              <Text style={styles.empty}>No claims yet</Text>
            ) : (
              claims.slice(0, 3).map(claim => (
                <ClaimRow key={claim.id} claim={claim} formatDate={formatDate} onDelete={handleDeleteClaim} />
              ))
            )}

            {/* Action buttons */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('Claim', { userId })}
            >
              <Text style={styles.actionButtonText}>File a claim</Text>
            </TouchableOpacity>

            {!activePolicy && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#7c3aed' }]}
                onPress={() => navigation.navigate('Policy', { userId })}
              >
                <Text style={styles.actionButtonText}>Buy a policy</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── CLAIMS TAB ── */}
        {tab === 'claims' && (
          <>
            <Text style={styles.sectionTitle}>{claims.length} claim{claims.length !== 1 ? 's' : ''} total</Text>
            {claims.length === 0 ? (
              <Text style={styles.empty}>You haven't filed any claims yet.</Text>
            ) : (
              claims.map(claim => (
                <ClaimRow key={claim.id} claim={claim} formatDate={formatDate} expanded onDelete={handleDeleteClaim} />
              ))
            )}
          </>
        )}

        {/* ── POLICIES TAB ── */}
        {tab === 'policies' && (
          <>
            <Text style={styles.sectionTitle}>{policies.length} polic{policies.length !== 1 ? 'ies' : 'y'} purchased</Text>
            {policies.length === 0 ? (
              <Text style={styles.empty}>No policies purchased yet.</Text>
            ) : (
              policies.map(policy => (
                <View key={policy.id} style={styles.policyRow}>
                  <View style={styles.policyRowLeft}>
                    <View style={[styles.planDot, { backgroundColor: POLICY_COLORS[policy.planId] || '#888' }]} />
                    <View>
                      <Text style={styles.policyRowName}>{policy.planName} plan</Text>
                      <Text style={styles.policyRowDates}>
                        {formatDate(policy.weekStart)} — {formatDate(policy.weekEnd)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.policyRowRight}>
                    <Text style={styles.policyRowPrice}>₹{policy.premiumPaid}</Text>
                    <Text style={styles.policyRowCoverage}>covers ₹{policy.coverageAmount}</Text>
                    <TouchableOpacity onPress={() => handleDeletePolicy(policy.id)}>
                      <Text style={styles.deleteBtn}>🗑</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('Policy', { userId })}
            >
              <Text style={styles.actionButtonText}>Buy this week's policy</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </View>
  );
}

function ClaimRow({ claim, formatDate, expanded, onDelete }) {
  const statusStyle = STATUS_COLORS[claim.status] || STATUS_COLORS.submitted;
  return (
    <View style={styles.claimCard}>
      <View style={styles.claimCardTop}>
        <Text style={styles.claimType}>
          {claim.eventType?.replace('_', ' ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusText, { color: statusStyle.text }]}>
              {claim.status}
            </Text>
          </View>
          <TouchableOpacity onPress={() => onDelete(claim.id)}>
            <Text style={styles.deleteBtn}>🗑</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.claimDate}>{formatDate(claim.reportedAt)}</Text>
      <View style={styles.claimAmountRow}>
        <Text style={styles.claimAmountLabel}>Claimed</Text>
        <Text style={styles.claimAmount}>₹{claim.estimatedLoss}</Text>
        {claim.payoutAmount > 0 && (
          <>
            <Text style={styles.claimAmountLabel}>  Paid out</Text>
            <Text style={[styles.claimAmount, { color: '#16a34a' }]}>₹{claim.payoutAmount}</Text>
          </>
        )}
      </View>
      {expanded && claim.description ? (
        <Text style={styles.claimDesc}>{claim.description}</Text>
      ) : null}
      {expanded && claim.aiScore !== null && claim.aiScore !== undefined ? (
        <Text style={styles.claimScore}>AI confidence: {claim.aiScore}%</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 12, color: '#bfdbfe', marginTop: 2 },
  logout: { fontSize: 13, color: '#bfdbfe' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#2563eb' },
  tabText: { fontSize: 13, color: '#9ca3af', fontWeight: '500' },
  tabTextActive: { color: '#2563eb' },
  scroll: { padding: 16, paddingBottom: 40 },

  policyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },
  policyCardLabel: { fontSize: 11, color: '#888', fontWeight: '600', marginBottom: 4 },
  policyCardName: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  policyCardCoverage: { fontSize: 14, color: '#444', fontWeight: '500', marginBottom: 2 },
  policyCardDates: { fontSize: 12, color: '#888', marginBottom: 10 },
  eventChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  eventChip: {
    backgroundColor: '#f3f4f6', paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 20,
  },
  eventChipText: { fontSize: 11, color: '#6b7280' },

  noPolicyCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20,
    marginBottom: 12, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#e5e7eb',
  },
  noPolicyTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  noPolicySub: { fontSize: 13, color: '#888', marginBottom: 16 },
  buyButton: {
    backgroundColor: '#2563eb', paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 8,
  },
  buyButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  modifierCard: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modifierLabel: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  modifierValue: { fontSize: 18, fontWeight: '700', color: '#b45309' },
  modifierHint: { fontSize: 11, color: '#92400e', flex: 1 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10,
    padding: 12, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#e5e7eb',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2, textAlign: 'center' },

  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#444',
    marginBottom: 10, marginTop: 4,
  },
  empty: { fontSize: 13, color: '#aaa', textAlign: 'center', marginTop: 20 },

  claimCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 0.5, borderColor: '#e5e7eb',
  },
  claimCardTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  claimType: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', textTransform: 'capitalize' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '600' },
  claimDate: { fontSize: 12, color: '#888', marginBottom: 8 },
  claimAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  claimAmountLabel: { fontSize: 12, color: '#888' },
  claimAmount: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  deleteBtn: { fontSize: 16, padding: 2 },
  claimDesc: { fontSize: 12, color: '#666', marginTop: 8, fontStyle: 'italic' },
  claimScore: { fontSize: 11, color: '#3b82f6', marginTop: 6 },

  policyRow: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 0.5, borderColor: '#e5e7eb',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  policyRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planDot: { width: 10, height: 10, borderRadius: 5 },
  policyRowName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  policyRowDates: { fontSize: 11, color: '#888', marginTop: 2 },
  policyRowRight: { alignItems: 'flex-end' },
  policyRowPrice: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  policyRowCoverage: { fontSize: 11, color: '#888' },

  actionButton: {
    backgroundColor: '#2563eb', padding: 15, borderRadius: 12,
    alignItems: 'center', marginTop: 12,
  },
  actionButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});