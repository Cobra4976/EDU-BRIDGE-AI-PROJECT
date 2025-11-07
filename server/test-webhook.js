// test-webhook.js - Run this to simulate IntaSend webhooks
import axios from 'axios';

const BACKEND_URL = 'http://localhost:3001';

// ✅ Test 1: Simulate successful payment webhook
async function testSuccessfulPayment(userId) {
  console.log('\n🧪 TEST 1: Simulating successful Pro payment...\n');

  const mockWebhook = {
    state: 'COMPLETE',
    api_ref: `PRO-${userId}-${Date.now()}`,
    account: 'test-mpesa-account',
    id: 'test-payment-id-123',
    value: 270,
    currency: 'KES',
    created_at: new Date().toISOString(),
    mpesa_reference: 'TEST-MPESA-REF-123'
  };

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/intasend-webhook`,
      mockWebhook,
      {
        headers: {
          'Content-Type': 'application/json',
          // Optionally add test signature
          // 'x-intasend-signature': 'test-signature'
        }
      }
    );

    console.log('✅ Webhook Response:', response.data);
    console.log('\n📊 Check Firestore - User should now have Pro subscription!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// ✅ Test 2: Simulate failed payment
async function testFailedPayment(userId) {
  console.log('\n🧪 TEST 2: Simulating failed payment...\n');

  const mockWebhook = {
    state: 'FAILED',
    api_ref: `PRO-${userId}-${Date.now()}`,
    account: 'test-mpesa-account',
    id: 'test-payment-id-456',
    value: 270,
    currency: 'KES',
    created_at: new Date().toISOString(),
    failed_reason: 'Insufficient funds'
  };

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/intasend-webhook`,
      mockWebhook
    );

    console.log('✅ Webhook Response:', response.data);
    console.log('\n📊 Check Firestore - Subscription should be marked as expired!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// ✅ Test 3: Check subscription status
async function checkSubscriptionStatus(userId) {
  console.log('\n🧪 TEST 3: Checking subscription status...\n');

  try {
    const response = await axios.get(
      `${BACKEND_URL}/api/subscription-status/${userId}`
    );

    console.log('✅ Subscription Status:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// ✅ Test 4: Simulate School License payment
async function testSchoolPayment(userId) {
  console.log('\n🧪 TEST 4: Simulating School License payment...\n');

  const mockWebhook = {
    state: 'COMPLETE',
    api_ref: `SCHOOL-${userId}-${Date.now()}`,
    account: 'test-mpesa-account',
    id: 'test-school-payment-789',
    value: 4000,
    currency: 'KES',
    created_at: new Date().toISOString()
  };

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/intasend-webhook`,
      mockWebhook
    );

    console.log('✅ Webhook Response:', response.data);
    console.log('\n📊 Check Firestore:');
    console.log('   - User should have School tier subscription');
    console.log('   - New "schools" collection document should be created\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// ✅ Test 5: Simulate subscription renewal
async function testSubscriptionRenewal(userId) {
  console.log('\n🧪 TEST 5: Simulating subscription renewal...\n');

  const mockWebhook = {
    event: 'subscription.renewed',
    subscription_id: 'test-sub-123',
    api_ref: `PRO-${userId}-${Date.now()}`,
    state: 'COMPLETE'
  };

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/intasend-subscription-webhook`,
      mockWebhook
    );

    console.log('✅ Webhook Response:', response.data);
    console.log('\n📊 Check Firestore - Subscription expiry should be extended by 30 days!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// ✅ Test 6: Simulate downgrade (expired/refund)
async function testDowngrade(userId) {
  console.log('\n🧪 TEST 6: Simulating downgrade to free...\n');

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/expire-subscription`,
      { userId }
    );

    console.log('✅ Downgrade Response:', response.data);
    console.log('\n📊 Check Firestore - User should be back on free tier!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// 🚀 RUN ALL TESTS
async function runAllTests() {
  // ⚠️ REPLACE THIS WITH YOUR ACTUAL FIREBASE USER ID
  const TEST_USER_ID = "PvmZmtxCHEVRBD3pgrLgyVKPJE53";

  if (TEST_USER_ID === 'YOUR_FIREBASE_USER_ID_HERE') {
    console.error('\n❌ ERROR: Please replace TEST_USER_ID with your actual Firebase user ID!\n');
    console.log('Get it from:');
    console.log('  1. Firebase Console > Authentication > Users');
    console.log('  2. Or from your React app console.log(user.uid)\n');
    return;
  }

  console.log('🚀 Starting Webhook Tests...');
  console.log(`📝 Testing with user ID: ${TEST_USER_ID}`);
  console.log('⚠️  Make sure your backend is running on http://localhost:3001\n');

  // Run tests in sequence
  await checkSubscriptionStatus(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
  await testSuccessfulPayment(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await checkSubscriptionStatus(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await testFailedPayment(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await testSchoolPayment(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await checkSubscriptionStatus(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await testSubscriptionRenewal(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await testDowngrade(TEST_USER_ID);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await checkSubscriptionStatus(TEST_USER_ID);

  console.log('\n✅ All tests completed! Check your terminal and Firestore for results.\n');
}

// Run the tests
runAllTests();