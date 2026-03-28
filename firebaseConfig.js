import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyAP2p4L30yr0pWYrtgXo6MsnyjF_m1JHug",
  authDomain: "gigguard-5bb97.firebaseapp.com",
  projectId: "gigguard-5bb97",
  storageBucket: "gigguard-5bb97.firebasestorage.app",
  messagingSenderId: "1037830089894",
  appId: "1:1037830089894:web:1084f480f10a4e65811867"
};

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});
export const db = getFirestore(app);
