import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, setPersistence, browserSessionPersistence } from 'firebase/auth';

export async function setupAuth(config, onChange) {
  const auth = getAuth(initializeApp(config));
  await setPersistence(auth, browserSessionPersistence);
  onAuthStateChanged(auth, onChange);
  return {
    register: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    verifyEmail: () => sendEmailVerification(auth.currentUser)
  };
}
