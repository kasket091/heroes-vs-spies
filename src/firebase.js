import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

export function initFirebase(config, { emulator = false, name } = {}) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db };
}

// Anonymous sign-in; after a reload the persisted user is reused, so the uid stays the same.
export async function signIn(auth) {
  await auth.authStateReady();
  return (auth.currentUser ?? (await signInAnonymously(auth)).user).uid;
}
