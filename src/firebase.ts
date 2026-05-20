import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyB-EdC11NCLMQz4trHNTFZmDfzphRixk40",
  authDomain: "chat-91286.firebaseapp.com",
  projectId: "chat-91286",
  storageBucket: "chat-91286.firebasestorage.app",
  messagingSenderId: "452961352199",
  appId: "1:452961352199:web:8c50f4ffd159a92b3888a2",
  measurementId: "G-ZFDG9NZCW0"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
