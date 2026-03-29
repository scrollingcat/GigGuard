import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { db } from './firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import DashboardScreen from './screens/DashboardScreen';
import PolicyScreen from './screens/PolicyScreen';
import ClaimScreen from './screens/ClaimScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [savedUserId, setSavedUserId] = useState(null);

  useEffect(() => {
    checkLoginState();
  }, []);

  const checkLoginState = async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        const workerDoc = await getDoc(doc(db, 'workers', userId));
        if (workerDoc.exists()) {
          setSavedUserId(userId);
          setInitialRoute('Dashboard');
        } else {
          setInitialRoute('Register');
        }
      } else {
        setInitialRoute('Login');
      }
    } catch (e) {
      setInitialRoute('Login');
    }
  };

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          initialParams={{ userId: savedUserId }}
        />
        <Stack.Screen name="Policy" component={PolicyScreen} />
        <Stack.Screen name="Claim" component={ClaimScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}