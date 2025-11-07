// backend/firebaseAdmin.js
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin
// You'll need to download your service account key from Firebase Console
const serviceAccount = JSON.parse(process.env.VITE_FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
  });
}

export const db = admin.firestore();
export const auth = admin.auth();

export default admin;