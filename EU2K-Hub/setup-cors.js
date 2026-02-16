/**
 * Script to set up CORS configuration for Firebase Storage bucket
 * Run this once to configure CORS for the bucket
 * 
 * Usage: node setup-cors.js
 * 
 * Requires: @google-cloud/storage package and proper authentication
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const storage = admin.storage();

const corsConfig = [
  {
    origin: ['https://eu2khub.eu', 'https://www.eu2khub.eu'],
    method: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE', 'OPTIONS'],
    responseHeader: ['Content-Type', 'Content-Length', 'ETag', 'x-goog-resumable', 'x-goog-hash'],
    maxAgeSeconds: 3600
  }
];

async function setupCORS() {
  try {
    const bucket = storage.bucket();
    await bucket.setCorsConfiguration(corsConfig);
    console.log(`✅ CORS configuration applied to bucket: ${bucket.name}`);
    console.log('CORS config:', JSON.stringify(corsConfig, null, 2));
  } catch (error) {
    console.error('❌ Error setting CORS configuration:', error);
    process.exit(1);
  }
}

setupCORS();

