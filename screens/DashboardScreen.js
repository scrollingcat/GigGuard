import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';


export default function DashboardScreen({ route, navigation }) {
  const { userId } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Welcome to GigGuard</Text>
      <Text style={styles.sub}>Your dashboard is being set up</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Active policy</Text>
        <Text style={styles.cardValue}>None</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Claims this week</Text>
        <Text style={styles.cardValue}>0</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Total paid out</Text>
        <Text style={styles.cardValue}>₹0</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Policy', { userId })}
      >
        <Text style={styles.buttonText}>Buy a policy</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#dc2626', marginTop: 8 }]}
        onPress={() => navigation.navigate('Claim', { userId })}
      >
        <Text style={styles.buttonText}>File a claim</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 24,
    paddingTop: 70,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: '#eee',
  },
  cardLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 6,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});