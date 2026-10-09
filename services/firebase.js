import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function initializeFirebase(env = process.env) {
  for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN']) {
    if (!env[name]) throw new Error('Set ' + name + ' in .env. See README.md (Spark-only setup).');
  }
  if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Production startup refuses emulator overrides. Use the separate test harness.');
  }
  const app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID, credential: applicationDefault() });
  return {
    auth: getAuth(app), db: getFirestore(app),
    clientConfig: { apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, appId: env.FIREBASE_APP_ID || null }
  };
}
