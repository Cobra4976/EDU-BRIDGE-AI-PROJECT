import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import axios from 'axios';
import mpesaService from '../server/services/mpesaService.js'; 
// ADD THESE IMPORTS FOR PART F
import admin, { db } from './firebaseAdmin.js';
import { 
  activateProSubscription, 
  activateSchoolSubscription, 
  renewSubscription,
  handleSubscriptionExpiry,
  downgradeToFree,
  cancelSubscription
} from './subscriptionManager.js';

dotenv.config();

// FIXED: Remove VITE_ prefix for backend environment variables
console.log('🔑 Gemini API Key loaded:', process.env.VITE_GEMINI_API_KEY ? 'YES ✅' : 'NO ❌');
console.log('🔑 IntaSend Secret Key loaded:', process.env.VITE_INTASEND_SECRET_KEY ? 'YES ✅' : 'NO ❌');
console.log('🔑 IntaSend Publishable Key loaded:', process.env.VITE_INTASEND_PUBLISHABLE_KEY ? 'YES ✅' : 'NO ❌');
// M-PESA ENVIRONMENT CHECKS
console.log('🔑 M-Pesa Consumer Key loaded:', process.env.MPESA_CONSUMER_KEY ? 'YES ✅' : 'NO ❌');
console.log('🔑 M-Pesa Consumer Secret loaded:', process.env.MPESA_CONSUMER_SECRET ? 'YES ✅' : 'NO ❌');
console.log('🔑 M-Pesa Passkey loaded:', process.env.MPESA_PASSKEY ? 'YES ✅' : 'NO ❌');
console.log('🔑 M-Pesa Shortcode:', process.env.MPESA_SHORTCODE || 'NOT SET ❌');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Gemini AI setup
const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

// IntaSend configuration
const INTASEND_SECRET_KEY = process.env.VITE_INTASEND_SECRET_KEY;
const INTASEND_PUBLISHABLE_KEY = process.env.VITE_INTASEND_PUBLISHABLE_KEY;
// FIXED: Use sandbox URL for test keys, production URL for live keys
const INTASEND_API_URL = INTASEND_PUBLISHABLE_KEY?.includes('_test_') 
  ? 'https://sandbox.intasend.com/api/v1'
  : 'https://payment.intasend.com/api/v1';

// Existing Claude/Gemini endpoint
app.post('/api/claude', async (req, res) => {
  try {
    const { systemPrompt, userPrompt, maxTokens = 4096 } = req.body;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const fullPrompt = `${systemPrompt}\n\nUser Query: ${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      content: [{ text: text }],
      response: text
    });
  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({
      error: {
        message: error.message || 'Failed to get response from Gemini'
      }
    });
  }
});
// ============================================
// M-PESA PAYMENT ROUTES (ADD THIS SECTION)
// ============================================

/**
 * Initiate M-Pesa STK Push payment
 */
app.post('/api/payment/mpesa/initiate', async (req, res) => {
  try {
    const { phoneNumber, amount, userId, subscriptionTier } = req.body;

    console.log('📱 M-Pesa payment initiation:', { phoneNumber, amount, userId, subscriptionTier });

    // Validate input
    if (!phoneNumber || !amount || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phoneNumber, amount, userId'
      });
    }

    // Validate transaction
    const validation = mpesaService.validateTransaction(phoneNumber, amount);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors
      });
    }

    // Create transaction record in Firestore
    const transactionRef = db.collection('transactions').doc();
    const transactionId = transactionRef.id;

    const transactionData = {
      transactionId,
      userId,
      phoneNumber: mpesaService.formatPhoneNumber(phoneNumber),
      amount: Math.round(amount),
      subscriptionTier: subscriptionTier || 'premium',
      status: 'pending',
      provider: 'mpesa',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await transactionRef.set(transactionData);

    // Initiate STK Push
    const result = await mpesaService.initiateSTKPush(
      phoneNumber,
      amount,
      userId, // Account reference
      `Premium Subscription - ${transactionId.substring(0, 8)}`
    );

    if (result.success) {
      // Update transaction with M-Pesa details
      await transactionRef.update({
        checkoutRequestId: result.checkoutRequestId,
        merchantRequestId: result.merchantRequestId,
        responseCode: result.responseCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('✅ M-Pesa STK Push initiated successfully');

      return res.json({
        success: true,
        transactionId,
        checkoutRequestId: result.checkoutRequestId,
        message: result.customerMessage || 'Please check your phone to complete payment'
      });
    } else {
      // Update transaction as failed
      await transactionRef.update({
        status: 'failed',
        error: result.error,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ M-Pesa payment initiation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * M-Pesa callback endpoint - receives payment confirmation
 */
app.post('/api/payment/mpesa/callback', async (req, res) => {
  try {
    console.log('📩 M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

    // Process callback
    const result = mpesaService.processCallback(req.body);

    // Find transaction
    const transactionQuery = await db.collection('transactions')
      .where('checkoutRequestId', '==', result.checkoutRequestId)
      .limit(1)
      .get();

    if (transactionQuery.empty) {
      console.error('❌ Transaction not found for checkout:', result.checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const transactionDoc = transactionQuery.docs[0];
    const transactionData = transactionDoc.data();

    if (result.success) {
      // Payment successful
      console.log('✅ Payment successful:', result);

      // Update transaction
      await transactionDoc.ref.update({
        status: 'completed',
        mpesaReceiptNumber: result.mpesaReceiptNumber,
        transactionDate: result.transactionDate,
        paidAmount: result.amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Upgrade user subscription
      const subscriptionRef = db.collection('subscriptions').doc(transactionData.userId);
      
      // Check if subscription document exists
      const subscriptionSnap = await subscriptionRef.get();
      
      if (!subscriptionSnap.exists()) {
        // Create new subscription
        await subscriptionRef.set({
          userId: transactionData.userId,
          tier: 'premium',
          status: 'active',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentDetails: {
            provider: 'mpesa',
            transactionId: transactionData.transactionId,
            mpesaReceiptNumber: result.mpesaReceiptNumber,
            amount: result.amount,
            currency: 'KES',
            paidAt: admin.firestore.FieldValue.serverTimestamp()
          },
          premiumSince: admin.firestore.FieldValue.serverTimestamp(),
          nextBillingDate: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
          ),
          usage: {
            aiTutorQueries: { count: 0, lastReset: new Date().toISOString(), resetPeriod: 'daily' },
            taskGeneration: { count: 0, lastReset: new Date().toISOString(), resetPeriod: 'weekly' },
            skillsAnalysis: { count: 0, lastReset: new Date().toISOString(), resetPeriod: 'weekly' },
            learningPaths: { count: 0, lastReset: new Date().toISOString(), resetPeriod: 'weekly' },
            achievements: { count: 0, lastReset: new Date().toISOString(), resetPeriod: 'weekly' }
          }
        });
      } else {
        // Update existing subscription
        await subscriptionRef.update({
          tier: 'premium',
          status: 'active',
          upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentDetails: {
            provider: 'mpesa',
            transactionId: transactionData.transactionId,
            mpesaReceiptNumber: result.mpesaReceiptNumber,
            amount: result.amount,
            currency: 'KES',
            paidAt: admin.firestore.FieldValue.serverTimestamp()
          },
          premiumSince: admin.firestore.FieldValue.serverTimestamp(),
          nextBillingDate: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          )
        });
      }

      console.log('🎉 Subscription upgraded for user:', transactionData.userId);

    } else {
      // Payment failed
      console.log('❌ Payment failed:', result);

      await transactionDoc.ref.update({
        status: 'failed',
        error: result.errorMessage || result.resultDesc,
        resultCode: result.resultCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Respond to M-Pesa
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  } catch (error) {
    console.error('❌ M-Pesa callback error:', error);
    return res.json({ ResultCode: 1, ResultDesc: 'Failed' });
  }
});

/**
 * M-Pesa timeout callback
 */
app.post('/api/payment/mpesa/timeout', async (req, res) => {
  console.log('⏰ M-Pesa Timeout:', JSON.stringify(req.body, null, 2));
  
  try {
    const { CheckoutRequestID } = req.body;

    // Find and update transaction
    const transactionQuery = await db.collection('transactions')
      .where('checkoutRequestId', '==', CheckoutRequestID)
      .limit(1)
      .get();

    if (!transactionQuery.empty) {
      await transactionQuery.docs[0].ref.update({
        status: 'timeout',
        error: 'Payment timeout - User did not complete payment',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('❌ Timeout processing error:', error);
    return res.json({ ResultCode: 1, ResultDesc: 'Failed' });
  }
});

/**
 * Check M-Pesa payment status
 */
app.get('/api/payment/mpesa/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    const transaction = transactionDoc.data();

    // If still pending and has checkoutRequestId, query M-Pesa
    if (transaction.status === 'pending' && transaction.checkoutRequestId) {
      const result = await mpesaService.querySTKPushStatus(transaction.checkoutRequestId);
      
      if (result.success) {
        // Update based on result code
        let newStatus = transaction.status;
        if (result.resultCode === '0') {
          newStatus = 'completed';
        } else if (result.resultCode === '1032') {
          newStatus = 'cancelled';
        } else {
          newStatus = 'failed';
        }

        if (newStatus !== transaction.status) {
          await transactionDoc.ref.update({
            status: newStatus,
            resultCode: result.resultCode,
            resultDesc: result.resultDesc,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          transaction.status = newStatus;
        }
      }
    }

    return res.json({
      success: true,
      transaction: {
        transactionId: transaction.transactionId,
        status: transaction.status,
        amount: transaction.amount,
        phoneNumber: transaction.phoneNumber,
        mpesaReceiptNumber: transaction.mpesaReceiptNumber,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// END M-PESA PAYMENT ROUTES
// ============================================


// ============================================
// INTASEND PAYMENT ROUTES
// ============================================

// Create payment link
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, currency, email, firstName, lastName, apiRef, comment } = req.body;

    console.log('📝 Creating payment:', { 
      amount, 
      currency, 
      email, 
      apiRef,
      publishableKeyPresent: !!INTASEND_PUBLISHABLE_KEY
    });

    // Validate required fields
    if (!amount || !currency || !email || !apiRef) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: amount, currency, email, or apiRef'
      });
    }

    // Check if publishable key is configured
    if (!INTASEND_PUBLISHABLE_KEY) {
      console.error('❌ IntaSend publishable key not configured!');
      return res.status(500).json({
        success: false,
        error: 'IntaSend publishable key not configured on server'
      });
    }

    // Create checkout session
    const response = await axios.post(
      `${INTASEND_API_URL}/checkout/`,
      {
        public_key: INTASEND_PUBLISHABLE_KEY,
        amount: Number(amount),
        currency: currency.toUpperCase(),
        email: email,
        // Clean names - remove special characters like apostrophes
        first_name: (firstName || 'User').replace(/[^a-zA-Z0-9\s_-]/g, ''),
        last_name: (lastName || 'Name').replace(/[^a-zA-Z0-9\s_-]/g, ''),
        api_ref: apiRef,
        redirect_url: `${req.headers.origin || 'http://localhost:5173'}/payment-success`,
        // Don't specify method - users get all payment options
        comment: comment || 'Payment'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log('✅ Payment created successfully:', {
      url: response.data.url,
      id: response.data.id
    });

    res.json({
      success: true,
      checkoutUrl: response.data.url,
      paymentId: response.data.id
    });

  } catch (error) {
    // Log the full error details
    console.error('❌ IntaSend payment creation error:');
    console.error('Status:', error.response?.status);
    console.error('Status Text:', error.response?.statusText);
    console.error('Error Data:', error.response?.data);
    console.error('Error Message:', error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.response?.data?.detail || error.message,
      details: error.response?.data
    });
  }
});

// Verify payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { apiRef } = req.body;

    console.log('🔍 Verifying payment:', apiRef);

    if (!INTASEND_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'IntaSend secret key not configured'
      });
    }

    const response = await axios.get(
      `${INTASEND_API_URL}/checkout/?api_ref=${apiRef}`,
      {
        headers: {
          'Authorization': `Bearer ${INTASEND_SECRET_KEY}`
        }
      }
    );

    const payment = response.data.results[0];
    const verified = payment && payment.state === 'COMPLETE';

    console.log('✅ Payment verification result:', {
      verified,
      state: payment?.state,
      apiRef
    });

    res.json({
      success: true,
      verified,
      payment
    });

  } catch (error) {
    console.error('❌ Payment verification error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });

    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

/**
 * IntaSend Webhook Handler - Handles all payment lifecycle events
 * Events: COMPLETE, FAILED, PENDING, PROCESSING, RETRY
 */
app.post('/api/intasend-webhook', async (req, res) => {
  try {
    const paymentData = req.body;

    console.log('📩 IntaSend webhook received:', JSON.stringify(paymentData, null, 2));

    // ⚠️ SECURITY: Verify webhook signature in production
    const signature = req.headers['x-intasend-signature'];
    
    // TODO: Implement signature verification for production
    // For now, we'll log it
    if (signature) {
      console.log('🔐 Webhook signature received:', signature);
      // const isValid = verifyIntaSendSignature(signature, paymentData, INTASEND_SECRET_KEY);
      // if (!isValid) {
      //   console.error('❌ Invalid webhook signature!');
      //   return res.status(401).json({ error: 'Invalid signature' });
      // }
    } else {
      console.warn('⚠️ No webhook signature - only use in development!');
    }

    // Extract payment info
    const { state, api_ref, account, id, value, currency } = paymentData;
    
    if (!api_ref) {
      console.error('❌ No api_ref in webhook data');
      return res.status(400).json({ error: 'Missing api_ref' });
    }

    // Parse api_ref: "PRO-userId123-timestamp" or "SCHOOL-userId123-timestamp"
    const parts = api_ref.split('-');
    const tier = parts[0]; // PRO or SCHOOL
    const userId = parts[1];

    console.log(`📊 Webhook details:`, {
      state,
      tier,
      userId,
      amount: value,
      currency,
      account
    });

    // Handle different payment states
    switch (state) {
      case 'COMPLETE':
        console.log(`✅ Payment COMPLETE for ${tier} tier, user: ${userId}`);
        
        let result;
        if (tier === 'PRO') {
          result = await activateProSubscription(userId, paymentData);
        } else if (tier === 'SCHOOL') {
          result = await activateSchoolSubscription(userId, paymentData);
        } else {
          console.error('❌ Unknown tier in api_ref:', tier);
          return res.status(400).json({ error: 'Invalid tier in api_ref' });
        }

        if (result && result.success) {
          console.log(`🎉 Subscription activated successfully for ${userId}`);
          
          // TODO: Send confirmation email to user
          // await sendConfirmationEmail(userId, tier);
          
        } else {
          console.error(`❌ Failed to activate subscription:`, result?.error || 'Unknown error');
        }
        break;

      case 'FAILED':
        console.log(`❌ Payment FAILED for apiRef: ${api_ref}`);
        
        // Mark subscription as failed
        const failResult = await handleSubscriptionExpiry(userId);
        
        if (failResult.success) {
          console.log(`⚠️ User ${userId} subscription marked as expired due to failed payment`);
          
          // TODO: Send payment failed email
          // await sendPaymentFailedEmail(userId);
        }
        break;

      case 'PENDING':
        console.log(`⏳ Payment PENDING for apiRef: ${api_ref}`);
        // No action needed - wait for final state
        break;

      case 'PROCESSING':
        console.log(`⚙️ Payment PROCESSING for apiRef: ${api_ref}`);
        // No action needed - wait for completion
        break;

      case 'RETRY':
        console.log(`🔄 Payment RETRY for apiRef: ${api_ref}`);
        // IntaSend will retry the payment
        break;

      default:
        console.warn(`⚠️ Unknown payment state: ${state}`);
    }

    // Always respond with 200 to acknowledge receipt
    res.json({ 
      received: true, 
      state,
      userId,
      tier,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // Still return 200 to prevent IntaSend from retrying
    // Log error for manual investigation
    res.status(200).json({ 
      received: true, 
      error: error.message,
      note: 'Error logged for manual review'
    });
  }
});

/**
 * Handle recurring subscription renewals
 * IntaSend will send webhook when subscription renews
 */
app.post('/api/intasend-subscription-webhook', async (req, res) => {
  try {
    const subscriptionData = req.body;

    console.log('🔄 Subscription webhook received:', JSON.stringify(subscriptionData, null, 2));

    const { event, subscription_id, api_ref, state } = subscriptionData;

    if (!api_ref) {
      return res.status(400).json({ error: 'Missing api_ref' });
    }

    const parts = api_ref.split('-');
    const tier = parts[0].toLowerCase(); // 'pro' or 'school'
    const userId = parts[1];

    switch (event) {
      case 'subscription.renewed':
        console.log(`🔄 Subscription renewed for user ${userId}, tier: ${tier}`);
        const renewResult = await renewSubscription(userId, tier);
        
        if (renewResult.success) {
          console.log(`✅ Subscription extended for ${userId}`);
        }
        break;

      case 'subscription.cancelled':
        console.log(`🚫 Subscription cancelled for user ${userId}`);
        const cancelResult = await cancelSubscription(userId);
        
        if (cancelResult.success) {
          console.log(`✅ Subscription marked as cancelled for ${userId}`);
        }
        break;

      case 'subscription.expired':
        console.log(`⏰ Subscription expired for user ${userId}`);
        const expireResult = await downgradeToFree(userId);
        
        if (expireResult.success) {
          console.log(`✅ User ${userId} downgraded to free tier`);
        }
        break;

      case 'payment.refund':
        console.log(`💰 Refund issued for user ${userId}`);
        const refundResult = await downgradeToFree(userId);
        
        if (refundResult.success) {
          console.log(`✅ User ${userId} downgraded due to refund`);
        }
        break;

      default:
        console.warn(`⚠️ Unknown subscription event: ${event}`);
    }

    res.json({ 
      received: true, 
      event,
      userId 
    });

  } catch (error) {
    console.error('❌ Subscription webhook error:', error);
    res.status(200).json({ 
      received: true, 
      error: error.message 
    });
  }
});

/**
 * Manual subscription management endpoints (for admin/testing)
 */

// Manually activate subscription (for testing)
app.post('/api/activate-subscription', async (req, res) => {
  try {
    const { userId, tier } = req.body;

    if (!userId || !tier) {
      return res.status(400).json({ error: 'userId and tier required' });
    }

    console.log(`🔧 Manual activation requested for user ${userId}, tier: ${tier}`);

    let result;
    if (tier === 'pro') {
      result = await activateProSubscription(userId, { account: 'manual-test' });
    } else if (tier === 'school') {
      result = await activateSchoolSubscription(userId, { id: 'manual-test' });
    } else {
      return res.status(400).json({ error: 'Invalid tier. Use "pro" or "school"' });
    }

    res.json(result);

  } catch (error) {
    console.error('Error activating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manually expire subscription (for testing)
app.post('/api/expire-subscription', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    console.log(`🔧 Manual expiry requested for user ${userId}`);

    const result = await downgradeToFree(userId);
    res.json(result);

  } catch (error) {
    console.error('Error expiring subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check subscription status
app.get('/api/subscription-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const teacherRef = db.collection('teachers').doc(userId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const data = teacherSnap.data();
    const subscriptionData = {
      tier: data.subscriptionTier || 'free',
      status: data.subscriptionStatus || 'active',
      expiry: data.subscriptionExpiry?.toDate().toISOString() || null,
      lastPayment: data.lastPaymentDate?.toDate().toISOString() || null,
      schoolId: data.schoolId || null,
      schoolRole: data.schoolRole || null
    };

    res.json({ success: true, subscription: subscriptionData });

  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({ error: error.message });
  }
});







// app.post('/api/intasend-webhook', async (req, res) => {
//   try {
//     const paymentData = req.body;

//     console.log('📩 IntaSend webhook received:', JSON.stringify(paymentData, null, 2));

//     // Verify webhook signature (IMPORTANT for production!)
//     const signature = req.headers['x-intasend-signature'];
//     // TODO: Implement signature verification
//     // const isValid = verifyIntaSendSignature(signature, paymentData);
//     // if (!isValid) {
//     //   return res.status(401).json({ error: 'Invalid signature' });
//     // }

//     if (paymentData.state === 'COMPLETE') {
//       // Payment successful
//       const apiRef = paymentData.api_ref;
      
//       // Extract info from apiRef (e.g., "PRO-userId123-timestamp")
//       const parts = apiRef.split('-');
//       const tier = parts[0]; // PRO or SCHOOL
//       const userId = parts[1];

//       console.log(`✅ Payment successful for ${tier} tier, user: ${userId}`);
      
//       // Update subscription in Firestore
//       let result;
//       if (tier === 'PRO') {
//         result = await activateProSubscription(userId, paymentData);
//       } else if (tier === 'SCHOOL') {
//         result = await activateSchoolSubscription(userId, paymentData);
//       }

//       if (result && result.success) {
//         console.log(`🎉 Subscription activated successfully for ${userId}`);
//       } else {
//         console.error(`❌ Failed to activate subscription:`, result?.error || 'Unknown error');
//       }
//     } else if (paymentData.state === 'FAILED') {
//       console.log(`❌ Payment failed for apiRef: ${paymentData.api_ref}`);
//       // Optionally handle failed payments
//     }

//     res.json({ received: true });

//   } catch (error) {
//     console.error('❌ Webhook error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// PART F: Manual subscription activation (for testing without actual payments)
app.post('/api/activate-subscription', async (req, res) => {
  try {
    const { userId, tier } = req.body;

    if (!userId || !tier) {
      return res.status(400).json({ error: 'userId and tier required' });
    }

    console.log(`🔧 Manual activation requested for user ${userId}, tier: ${tier}`);

    let result;
    if (tier === 'pro') {
      result = await activateProSubscription(userId, { account: 'manual-test' });
    } else if (tier === 'school') {
      result = await activateSchoolSubscription(userId, { id: 'manual-test' });
    } else {
      return res.status(400).json({ error: 'Invalid tier. Use "pro" or "school"' });
    }

    res.json(result);

  } catch (error) {
    console.error('Error activating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    intasend: INTASEND_PUBLISHABLE_KEY ? 'configured' : 'missing',
    publishableKeyFormat: INTASEND_PUBLISHABLE_KEY ? INTASEND_PUBLISHABLE_KEY.substring(0, 15) + '...' : 'N/A',
    timestamp: new Date().toISOString() 
  });
});
// ============================================
// STUDENT DASHBOARD AI ENDPOINTS
// ============================================

/**
 * Generate personalized tasks for students
 */
app.post('/api/student/generate-tasks', async (req, res) => {
  try {
    const { studentProfile } = req.body;

    if (!studentProfile) {
      return res.status(400).json({ error: 'studentProfile required' });
    }

    const systemPrompt = `You are an educational assistant. Generate 4 practical study tasks for a single student based on the profile below.
Return the result strictly as JSON: an array of task objects.
Each task object must have:
- "title" (short),
- "description" (concise steps or resources),
- "difficulty" ("Easy"|"Medium"|"Hard"),
- "estimatedMinutes" (integer)
- "answer" (detailed solution/answer with step-by-step explanation)

For the "answer" field:
- Provide complete solutions for problems/exercises
- Include step-by-step explanations
- Add helpful tips or common mistakes to avoid
- Make answers educational and detailed (3-5 sentences minimum)
- Format for easy reading

Use local context where useful and keep tasks actionable in low-resource settings.
Return only JSON.`;

    const userPrompt = `Student profile:
- Name: ${studentProfile.name || 'Student'}
- Country: ${studentProfile.country || 'Unknown'}
- Educational System: ${studentProfile.educationalSystem || 'Unknown'}
- Strengths: ${studentProfile.strengths || 'None'}
- Weaknesses: ${studentProfile.weaknesses || 'None'}`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Tasks generated for student');

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Generate tasks error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Analyze student skills (academic + technology)
 */
app.post('/api/student/analyze-skills', async (req, res) => {
  try {
    const { studentProfile } = req.body;

    if (!studentProfile) {
      return res.status(400).json({ error: 'studentProfile required' });
    }

    const systemPrompt = `You are an educational assessment assistant for African students.`;

    const userPrompt = `Based on the student's profile below, estimate TWO categories of skills:

1. ACADEMIC SKILLS (5-6 skills): Traditional academic competencies relevant to their education system
2. TECHNOLOGY SKILLS (5-6 skills): Digital literacy and tech skills relevant for career readiness

For each skill, provide a score from 0 to 100 indicating current competency.

Consider:
- Student's educational system and country context
- Available technology infrastructure in ${studentProfile.country || 'their region'}
- Career opportunities in African tech ecosystem
- Skills that can be learned with low resources (mobile-first)
- Local job market demands

Student profile:
- Name: ${studentProfile.name || 'Student'}
- Country: ${studentProfile.country || 'Unknown'}
- Educational System: ${studentProfile.educationalSystem || 'Unknown'}
- Strengths: ${studentProfile.strengths || 'None'}
- Weaknesses: ${studentProfile.weaknesses || 'None'}

Return strictly as JSON with this structure:
{
  "academic": {
    "Numeracy": 72,
    "Reading Comprehension": 80,
    "Problem Solving": 60,
    "Critical Thinking": 70,
    "Writing Skills": 65
  },
  "technology": {
    "Digital Literacy": 45,
    "Mobile Computing": 55,
    "Internet Research": 70,
    "Basic Coding": 30,
    "Data Entry & Spreadsheets": 65,
    "Email & Communication": 75
  }
}

Focus on practical, achievable tech skills that are in-demand in Africa.
Return only JSON.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Skills analyzed for student');

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Analyze skills error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate achievements for student
 */
app.post('/api/student/generate-achievements', async (req, res) => {
  try {
    const { studentProfile, tasks, skills } = req.body;

    if (!studentProfile) {
      return res.status(400).json({ error: 'studentProfile required' });
    }

    const tasksContext = JSON.stringify(tasks || []);
    const skillsContext = JSON.stringify(skills || {});

    const systemPrompt = `You are an achievement engine.`;

    const userPrompt = `Create up to 5 achievement objects for this student based on the profile, tasks, and skills.
Each achievement object should have:
- "title"
- "description"
- "criteria" (short explanation of how to earn it)
- "date" (ISO string or empty for not yet achieved)

Student profile:
- Name: ${studentProfile.name || 'Student'}
- Country: ${studentProfile.country || 'Unknown'}
- Educational System: ${studentProfile.educationalSystem || 'Unknown'}
- Strengths: ${studentProfile.strengths || 'None'}
- Weaknesses: ${studentProfile.weaknesses || 'None'}

Current tasks: ${tasksContext}
Current skills: ${skillsContext}

Return only JSON array.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Achievements generated for student');

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Generate achievements error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate skill learning path (academic or tech)
 */
app.post('/api/student/generate-learning-path', async (req, res) => {
  try {
    const { studentProfile, skillName, currentScore, category } = req.body;

    if (!studentProfile || !skillName || currentScore === undefined || !category) {
      return res.status(400).json({ 
        error: 'studentProfile, skillName, currentScore, and category required' 
      });
    }

    const isTechSkill = category === 'technology';

    const systemPrompt = `You are an educational content creator specializing in ${isTechSkill ? 'technology education for African students' : 'academic skill development'}.`;

    const userPrompt = `Generate a personalized learning path for this student to improve their ${skillName} skill from ${currentScore}% proficiency to mastery.

Student Profile:
- Name: ${studentProfile.name}
- Country: ${studentProfile.country}
- Educational System: ${studentProfile.educationalSystem}
- Strengths: ${studentProfile.strengths}
- Weaknesses: ${studentProfile.weaknesses}

${isTechSkill ? `
IMPORTANT for Technology Skills:
- Focus on mobile-first learning (most students use smartphones)
- Suggest FREE resources and tools available in Africa
- Consider low bandwidth situations
- Include practical projects they can do offline
- Mention local tech communities and opportunities (e.g., iHub Kenya, CcHub Nigeria)
- Emphasize skills valuable for freelancing/remote work
- Recommend apps available on Google Play Store
` : `
IMPORTANT for Academic Skills:
- Align with ${studentProfile.educationalSystem} curriculum
- Use local examples from ${studentProfile.country}
- Consider low-resource classroom settings
- Include offline practice activities
- Reference local educational resources
`}

Create a JSON response with:
{
  "learningSteps": [
    {
      "step": 1, 
      "title": "...", 
      "description": "Detailed explanation of what to learn...", 
      "estimatedDays": 3,
      "resources": "Specific free tools/apps/websites",
      "offline": true
    },
    ...5-7 progressive steps
  ],
  "practiceExercises": [
    {
      "title": "...", 
      "description": "Clear instructions for the exercise...", 
      "difficulty": "Easy",
      "toolsNeeded": "smartphone with internet",
      "estimatedTime": "30 mins"
    },
    ...4-6 exercises from easy to hard
  ],
  "quickTips": [
    "Practical tip 1 specific to ${studentProfile.country}",
    "Tip 2...",
    "Tip 3..."
  ],
  "freeResources": [
    {
      "name": "Resource name", 
      "type": "app|website|youtube|pdf", 
      "url": "actual URL or 'Available offline'",
      "offline": true,
      "description": "Why this resource is useful"
    },
    ...5-8 resources
  ],
  ${isTechSkill ? `
  "careerOpportunities": [
    "Specific job/freelance opportunity 1",
    "Opportunity 2...",
    "Opportunity 3..."
  ],
  ` : ''}
  "milestones": [
    {"progress": 25, "achievement": "What you'll achieve at 25%"},
    {"progress": 50, "achievement": "What you'll achieve at 50%"},
    {"progress": 75, "achievement": "What you'll achieve at 75%"},
    {"progress": 100, "achievement": "Master level achievement"}
  ]
}

Make it highly practical and achievable with limited resources.
Return only valid JSON.`;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        maxOutputTokens: 8000
      }
    });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log(`✅ Learning path generated for skill: ${skillName}`);

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Generate learning path error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * AI Tutor chat endpoint
 */
app.post('/api/student/tutor-chat', async (req, res) => {
  try {
    const { studentProfile, userMessage } = req.body;

    if (!studentProfile || !userMessage) {
      return res.status(400).json({ error: 'studentProfile and userMessage required' });
    }

    const systemPrompt = `You are a personalized AI tutor for ${studentProfile.name || 'a student'} who is studying ${studentProfile.educationalSystem || 'their curriculum'} in ${studentProfile.country || 'their country'}.

Student's Profile:
- Name: ${studentProfile.name || 'Student'}
- Country: ${studentProfile.country || 'Not specified'}
- Educational System: ${studentProfile.educationalSystem || 'Not specified'}
- Strengths: ${studentProfile.strengths || 'Not specified'}
- Areas for Improvement: ${studentProfile.weaknesses || 'Not specified'}

Be supportive, use local examples and low-tech suggestions where helpful.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const fullPrompt = `${systemPrompt}\n\nUser question: ${userMessage}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Tutor chat response generated');

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Tutor chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate skill recommendations
 */
app.post('/api/student/skill-recommendations', async (req, res) => {
  try {
    const { studentProfile, completedTasksCount, currentStreak, skills, activityLog } = req.body;

    if (!studentProfile) {
      return res.status(400).json({ error: 'studentProfile required' });
    }

    const currentSkillsContext = JSON.stringify(skills || {});
    const recentActivities = activityLog?.slice(-10) || [];

    const systemPrompt = `You are an AI educational advisor for African students.`;

    const userPrompt = `Based on the student's profile and progress, recommend 3-5 skills they should focus on next.

Student Profile:
- Name: ${studentProfile.name}
- Country: ${studentProfile.country}
- Educational System: ${studentProfile.educationalSystem}
- Strengths: ${studentProfile.strengths}
- Weaknesses: ${studentProfile.weaknesses}

Current Progress:
- Tasks Completed: ${completedTasksCount || 0}
- Current Streak: ${currentStreak || 0} days
- Current Skills: ${currentSkillsContext}
- Recent Activity: ${recentActivities.length} actions in last session

Consider:
1. Skills that complement their existing strengths
2. Skills that address their weaknesses
3. Skills in high demand in ${studentProfile.country}
4. Both academic and technology skills
5. Skills achievable with current resources

Return ONLY valid JSON with this structure:
{
  "recommendations": [
    {
      "skillName": "Skill name",
      "category": "academic|technology",
      "priority": "high|medium|low",
      "reason": "Why this skill is recommended (1-2 sentences)",
      "estimatedWeeks": 4,
      "prerequisites": ["Skill 1", "Skill 2"] or [],
      "careerBenefit": "How this helps career/academics"
    },
    ...3-5 recommendations
  ]
}

Prioritize practical, achievable skills. Return only JSON.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('✅ Skill recommendations generated');

    res.json({
      success: true,
      content: text
    });

  } catch (error) {
    console.error('❌ Skill recommendations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// END STUDENT DASHBOARD ENDPOINTS
// ============================================

// ============================================
// END INTASEND ROUTES
// ============================================


app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`💳 IntaSend integration: ${INTASEND_PUBLISHABLE_KEY ? 'ACTIVE ✅' : 'NOT CONFIGURED ❌'}`);
  console.log(`🌍 Using IntaSend ${INTASEND_PUBLISHABLE_KEY?.includes('_test_') ? 'SANDBOX (Test Mode)' : 'PRODUCTION (Live Mode)'}`);
  console.log(`🔗 API URL: ${INTASEND_API_URL}`);
  
  if (INTASEND_PUBLISHABLE_KEY) {
    console.log(`🔑 Publishable key format: ${INTASEND_PUBLISHABLE_KEY.substring(0, 20)}...`);
  }
  // M-PESA STATUS
  console.log(`📱 M-Pesa integration: ${process.env.MPESA_CONSUMER_KEY ? 'ACTIVE ✅' : 'NOT CONFIGURED ❌'}`);
  console.log(`🌍 M-Pesa mode: ${process.env.MPESA_BASE_URL?.includes('sandbox') ? 'SANDBOX (Test)' : 'PRODUCTION (Live)'}`);
  if (process.env.MPESA_CALLBACK_URL) {
    console.log(`🔗 M-Pesa callback: ${process.env.MPESA_CALLBACK_URL}`)
  }
});
// ============================================
// SCHOOL MANAGEMENT ENDPOINTS
// Add these to your index.js
// ============================================

import crypto from 'crypto';

// Store invite codes in memory (for production, use Redis or Firestore)
const inviteCodes = new Map();

/**
 * Generate invite code for school
 */
app.post('/api/school/generate-invite', async (req, res) => {
  try {
    const { adminUserId } = req.body;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId required' });
    }

    // Verify admin exists and is school admin
    const teacherRef = db.collection('teachers').doc(adminUserId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const teacherData = teacherSnap.data();

    if (teacherData.schoolRole !== 'admin') {
      return res.status(403).json({ error: 'Not a school admin' });
    }

    if (!teacherData.schoolId) {
      return res.status(400).json({ error: 'No school associated with this admin' });
    }

    // Get school data
    const schoolRef = db.collection('schools').doc(teacherData.schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolData = schoolSnap.data();

    // Check if school has available slots
    const currentTeachers = schoolData.teacherIds?.length || 0;
    if (currentTeachers >= schoolData.maxTeachers) {
      return res.status(400).json({ 
        error: 'School has reached maximum teacher limit',
        currentTeachers,
        maxTeachers: schoolData.maxTeachers
      });
    }

    // Generate unique invite code
    const inviteCode = crypto.randomBytes(16).toString('hex');
    const inviteData = {
      code: inviteCode,
      schoolId: teacherData.schoolId,
      schoolName: schoolData.schoolName,
      adminUserId: adminUserId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      used: false
    };

    // Store in memory (use Firestore for production)
    inviteCodes.set(inviteCode, inviteData);

    // Also store in Firestore for persistence
    await db.collection('inviteCodes').doc(inviteCode).set(inviteData);

    console.log(`✅ Generated invite code for school ${teacherData.schoolId}`);

    const inviteLink = `${req.headers.origin || 'http://localhost:5173'}/join-school?code=${inviteCode}`;

    res.json({
      success: true,
      inviteCode,
      inviteLink,
      expiresAt: inviteData.expiresAt
    });

  } catch (error) {
    console.error('Error generating invite:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Accept invite and join school
 */
app.post('/api/school/accept-invite', async (req, res) => {
  try {
    const { inviteCode, teacherUserId } = req.body;

    if (!inviteCode || !teacherUserId) {
      return res.status(400).json({ error: 'inviteCode and teacherUserId required' });
    }

    // Get invite data from Firestore
    const inviteRef = db.collection('inviteCodes').doc(inviteCode);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const inviteData = inviteSnap.data();

    // Check if invite is expired
    if (new Date(inviteData.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Invite code has expired' });
    }

    // Check if already used
    if (inviteData.used) {
      return res.status(400).json({ error: 'Invite code already used' });
    }

    // Get school data
    const schoolRef = db.collection('schools').doc(inviteData.schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolData = schoolSnap.data();

    // Check school capacity
    if (schoolData.teacherIds.length >= schoolData.maxTeachers) {
      return res.status(400).json({ error: 'School is at full capacity' });
    }

    // Check if teacher already in school
    if (schoolData.teacherIds.includes(teacherUserId)) {
      return res.status(400).json({ error: 'Teacher already in this school' });
    }

    // Get teacher data
    const teacherRef = db.collection('teachers').doc(teacherUserId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Update teacher profile
    await teacherRef.update({
      subscriptionTier: 'school',
      subscriptionStatus: schoolData.subscriptionStatus,
      subscriptionExpiry: schoolData.subscriptionExpiry,
      schoolId: inviteData.schoolId,
      schoolRole: 'teacher',
      updatedAt: new Date().toISOString()
    });

    // Add teacher to school
    await schoolRef.update({
      teacherIds: admin.firestore.FieldValue.arrayUnion(teacherUserId),
      updatedAt: admin.firestore.Timestamp.now()
    });

    // Mark invite as used
    await inviteRef.update({
      used: true,
      usedBy: teacherUserId,
      usedAt: new Date().toISOString()
    });

    console.log(`✅ Teacher ${teacherUserId} joined school ${inviteData.schoolId}`);

    res.json({
      success: true,
      message: 'Successfully joined school',
      schoolName: schoolData.schoolName,
      schoolId: inviteData.schoolId
    });

  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove teacher from school
 */
app.post('/api/school/remove-teacher', async (req, res) => {
  try {
    const { adminUserId, teacherUserId } = req.body;

    if (!adminUserId || !teacherUserId) {
      return res.status(400).json({ error: 'adminUserId and teacherUserId required' });
    }

    // Verify admin
    const adminRef = db.collection('teachers').doc(adminUserId);
    const adminSnap = await adminRef.get();

    if (!adminSnap.exists) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const adminData = adminSnap.data();

    if (adminData.schoolRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Can't remove yourself
    if (adminUserId === teacherUserId) {
      return res.status(400).json({ error: 'Cannot remove yourself as admin' });
    }

    // Get school
    const schoolRef = db.collection('schools').doc(adminData.schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolData = schoolSnap.data();

    // Check if teacher is in school
    if (!schoolData.teacherIds.includes(teacherUserId)) {
      return res.status(400).json({ error: 'Teacher not in this school' });
    }

    // Remove teacher from school
    await schoolRef.update({
      teacherIds: admin.firestore.FieldValue.arrayRemove(teacherUserId),
      updatedAt: admin.firestore.Timestamp.now()
    });

    // Downgrade teacher to free tier
    const teacherRef = db.collection('teachers').doc(teacherUserId);
    await teacherRef.update({
      subscriptionTier: 'free',
      subscriptionStatus: 'active',
      subscriptionExpiry: null,
      schoolId: null,
      schoolRole: null,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Removed teacher ${teacherUserId} from school ${adminData.schoolId}`);

    res.json({
      success: true,
      message: 'Teacher removed from school'
    });

  } catch (error) {
    console.error('Error removing teacher:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get school details and teacher list
 */
app.get('/api/school/:schoolId', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { adminUserId } = req.query;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId required' });
    }

    // Verify admin access
    const adminRef = db.collection('teachers').doc(adminUserId);
    const adminSnap = await adminRef.get();

    if (!adminSnap.exists) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const adminData = adminSnap.data();

    // ✅ Allow anyone who belongs to this school (admin or teacher)
if (adminData.schoolId !== schoolId) {
  return res.status(403).json({ error: 'Not authorized to view this school' });
}

// Note: We removed the adminData.schoolRole !== 'admin' check

    // if (adminData.schoolId !== schoolId || adminData.schoolRole !== 'admin') {
    //   return res.status(403).json({ error: 'Not authorized to view this school' });
    // }

    // Get school data
    const schoolRef = db.collection('schools').doc(schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolData = schoolSnap.data();
    // ✅ Safety check for undefined teacherIds
const teacherIds = schoolData.teacherIds || [];

const teacherPromises = teacherIds.map(async (teacherId) => {
  const tRef = db.collection('teachers').doc(teacherId);
  const tSnap = await tRef.get();
  
  if (tSnap.exists) {
    const tData = tSnap.data();
    return {
      id: teacherId,
      name: tData.name,
      email: tData.email,
      subjectArea: tData.subjectArea,
      gradeLevel: tData.gradeLevel,
      role: tData.schoolRole,
      joinedAt: tData.updatedAt
    };
  }
  return null;
});

const teachers = (await Promise.all(teacherPromises)).filter(t => t !== null);

    // // Get teacher details
    // const teacherPromises = schoolData.teacherIds.map(async (teacherId) => {
    //   const tRef = db.collection('teachers').doc(teacherId);
    //   const tSnap = await tRef.get();
      
    //   if (tSnap.exists) {
    //     const tData = tSnap.data();
    //     return {
    //       id: teacherId,
    //       name: tData.name,
    //       email: tData.email,
    //       subjectArea: tData.subjectArea,
    //       gradeLevel: tData.gradeLevel,
    //       role: tData.schoolRole,
    //       joinedAt: tData.updatedAt
    //     };
    //   }
    //   return null;
    // });

    // const teachers = (await Promise.all(teacherPromises)).filter(t => t !== null);
    // ✅ Helper function to safely convert dates
const toISOString = (date) => {
  if (!date) return null;
  if (typeof date === 'string') return date; // Already ISO string
  if (date.toDate) return date.toDate().toISOString(); // Firestore Timestamp
  if (date instanceof Date) return date.toISOString(); // JS Date
  return null;
};
    const response = {
      success: true,
      school: {
        id: schoolData.schoolId,
        name: schoolData.schoolName,
        adminId: schoolData.adminTeacherId,
        maxTeachers: schoolData.maxTeachers,
        currentTeachers: schoolData.teacherIds.length,
        availableSlots: schoolData.maxTeachers - schoolData.teacherIds.length,
        subscriptionStatus: schoolData.subscriptionStatus,
        subscriptionExpiry: schoolData.subscriptionExpiry?.toDate().toISOString(),
        createdAt: schoolData.createdAt?.toDate().toISOString()
      },
      teachers
    };

    res.json(response);

  } catch (error) {
    console.error('Error getting school:', error);
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/school/:schoolId', async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { adminUserId } = req.query;

    if (!adminUserId) {
      return res.status(400).json({ error: 'adminUserId required' });
    }

    // Verify user access
    const userRef = db.collection('teachers').doc(adminUserId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userSnap.data();

    // ✅ FIXED: Allow anyone who belongs to this school
    if (userData.schoolId !== schoolId) {
      return res.status(403).json({ error: 'Not authorized to view this school' });
    }

    // Get school data
    const schoolRef = db.collection('schools').doc(schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolData = schoolSnap.data();

    // ✅ FIXED: Add safety check for undefined teacherIds
    const teacherIds = schoolData.teacherIds || [];

    // Get teacher details
    const teacherPromises = teacherIds.map(async (teacherId) => {
      const tRef = db.collection('teachers').doc(teacherId);
      const tSnap = await tRef.get();
      
      if (tSnap.exists) {
        const tData = tSnap.data();
        return {
          id: teacherId,
          name: tData.name,
          email: tData.email,
          subjectArea: tData.subjectArea,
          gradeLevel: tData.gradeLevel,
          role: tData.schoolRole,
          joinedAt: tData.updatedAt
        };
      }
      return null;
    });

    const teachers = (await Promise.all(teacherPromises)).filter(t => t !== null);

    const response = {
      success: true,
      school: {
        id: schoolId,
        name: schoolData.name || schoolData.schoolName,
        adminId: schoolData.adminId || schoolData.adminTeacherId,
        maxTeachers: schoolData.totalSlots || schoolData.maxTeachers || 20,
        currentTeachers: teacherIds.length,
        availableSlots: (schoolData.totalSlots || schoolData.maxTeachers || 20) - teacherIds.length,
        subscriptionStatus: schoolData.subscriptionStatus,
        subscriptionExpiry: schoolData.subscriptionExpiry?.toDate?.().toISOString() || schoolData.subscriptionExpiry,
        createdAt: schoolData.createdAt?.toDate?.().toISOString() || schoolData.createdAt
      },
      teachers
    };

    res.json(response);

  } catch (error) {
    console.error('Error getting school:', error);
    res.status(500).json({ error: error.message });
  }
});








// /**
//  * Get school stats (for admin dashboard)
//  */
// app.get('/api/school/:schoolId/stats', async (req, res) => {
//   try {
//     const { schoolId } = req.params;

//     const schoolRef = db.collection('schools').doc(schoolId);
//     const schoolSnap = await schoolRef.get();

//     if (!schoolSnap.exists) {
//       return res.status(404).json({ error: 'School not found' });
//     }

//     const schoolData = schoolSnap.data();

//     // Calculate stats
//     const stats = {
//       totalSlots: schoolData.maxTeachers,
//       usedSlots: schoolData.teacherIds.length,
//       availableSlots: schoolData.maxTeachers - schoolData.teacherIds.length,
//       utilizationRate: ((schoolData.teacherIds.length / schoolData.maxTeachers) * 100).toFixed(1),
//       subscriptionStatus: schoolData.subscriptionStatus,
//       daysUntilExpiry: schoolData.subscriptionExpiry 
//         ? Math.ceil((schoolData.subscriptionExpiry.toDate() - new Date()) / (1000 * 60 * 60 * 24))
//         : null
//     };

//     res.json({ success: true, stats });

//   } catch (error) {
//     console.error('Error getting stats:', error);
//     res.status(500).json({ error: error.message });
//   }
// });






















// import express from 'express';
// import cors from 'cors';
// import { GoogleGenerativeAI } from '@google/generative-ai';
// import dotenv from 'dotenv';
// import axios from 'axios';

// dotenv.config();

// // FIXED: Remove VITE_ prefix for backend environment variables
// console.log('🔑 Gemini API Key loaded:', process.env.VITE_GEMINI_API_KEY ? 'YES ✅' : 'NO ❌');
// console.log('🔑 IntaSend Secret Key loaded:', process.env.VITE_INTASEND_SECRET_KEY ? 'YES ✅' : 'NO ❌');
// console.log('🔑 IntaSend Publishable Key loaded:', process.env.VITE_INTASEND_PUBLISHABLE_KEY ? 'YES ✅' : 'NO ❌');

// const app = express();
// const PORT = 3001;

// app.use(cors());
// app.use(express.json());

// // Gemini AI setup
// const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

// // IntaSend configuration
// const INTASEND_SECRET_KEY = process.env.VITE_INTASEND_SECRET_KEY;
// const INTASEND_PUBLISHABLE_KEY = process.env.VITE_INTASEND_PUBLISHABLE_KEY;
// // FIXED: Use sandbox URL for test keys, production URL for live keys
// const INTASEND_API_URL = INTASEND_PUBLISHABLE_KEY?.includes('_test_') 
//   ? 'https://sandbox.intasend.com/api/v1'
//   : 'https://payment.intasend.com/api/v1';

// // Existing Claude/Gemini endpoint
// app.post('/api/claude', async (req, res) => {
//   try {
//     const { systemPrompt, userPrompt, maxTokens = 4096 } = req.body;

//     const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
//     const fullPrompt = `${systemPrompt}\n\nUser Query: ${userPrompt}`;

//     const result = await model.generateContent(fullPrompt);
//     const response = await result.response;
//     const text = response.text();

//     res.json({
//       content: [{ text: text }],
//       response: text
//     });
//   } catch (error) {
//     console.error('Gemini API Error:', error);
//     res.status(500).json({
//       error: {
//         message: error.message || 'Failed to get response from Gemini'
//       }
//     });
//   }
// });

// // ============================================
// // INTASEND PAYMENT ROUTES
// // ============================================

// // Create payment link
// app.post('/api/create-payment', async (req, res) => {
//   try {
//     const { amount, currency, email, firstName, lastName, apiRef, comment } = req.body;

//     console.log('📝 Creating payment:', { 
//       amount, 
//       currency, 
//       email, 
//       apiRef,
//       publishableKeyPresent: !!INTASEND_PUBLISHABLE_KEY
//     });

//     // Validate required fields
//     if (!amount || !currency || !email || !apiRef) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields: amount, currency, email, or apiRef'
//       });
//     }

//     // Check if publishable key is configured
//     if (!INTASEND_PUBLISHABLE_KEY) {
//       console.error('❌ IntaSend publishable key not configured!');
//       return res.status(500).json({
//         success: false,
//         error: 'IntaSend publishable key not configured on server'
//       });
//     }

//     // Create checkout session
//     const response = await axios.post(
//   `${INTASEND_API_URL}/checkout/`,
//   {
//     public_key: INTASEND_PUBLISHABLE_KEY,
//     amount: Number(amount),
//     currency: currency.toUpperCase(),
//     email: email,
//     // Clean names - remove special characters like apostrophes
//     first_name: (firstName || 'User').replace(/[^a-zA-Z0-9\s_-]/g, ''),
//     last_name: (lastName || 'Name').replace(/[^a-zA-Z0-9\s_-]/g, ''),
//     api_ref: apiRef,
//     redirect_url: `${req.headers.origin || 'http://localhost:5173'}/payment-success`,
//     // Don't specify method - users get all payment options
//     comment: comment || 'Payment'
//   },
//   {
//     headers: {
//       'Content-Type': 'application/json',
//       'Accept': 'application/json'
//     }
//   }
// );

// // const response = await axios.post(
//     //   `${INTASEND_API_URL}/checkout/`,
//     //   {
//     //     public_key: INTASEND_PUBLISHABLE_KEY,
//     //     amount: Number(amount),
//     //     currency: currency.toUpperCase(),
//     //     email: email,
//     //     first_name: firstName || 'User',
//     //     last_name: lastName || 'Name',
//     //     api_ref: apiRef,
//     //     redirect_url: `${req.headers.origin || 'http://localhost:5173'}/payment-success`,
//     //     // IntaSend expects comma-separated string, not array
//     //     method: ['MPESA', 'CARD-PAYMENT', 'BANK-TRANSFER'],
//     //     comment: comment || 'Payment'
//     //   },
//     //   {
//     //     headers: {
//     //       'Content-Type': 'application/json',
//     //       'Accept': 'application/json'
//     //     }
//     //   }
//     // );

//     console.log('✅ Payment created successfully:', {
//       url: response.data.url,
//       id: response.data.id
//     });

//     res.json({
//       success: true,
//       checkoutUrl: response.data.url,
//       paymentId: response.data.id
//     });

//   } catch (error) {
//     // Log the full error details
//     console.error('❌ IntaSend payment creation error:');
//     console.error('Status:', error.response?.status);
//     console.error('Status Text:', error.response?.statusText);
//     console.error('Error Data:', error.response?.data);
//     console.error('Error Message:', error.message);

//     res.status(500).json({
//       success: false,
//       error: error.response?.data?.message || error.response?.data?.detail || error.message,
//       details: error.response?.data
//     });
//   }
// });

// // Verify payment
// app.post('/api/verify-payment', async (req, res) => {
//   try {
//     const { apiRef } = req.body;

//     console.log('🔍 Verifying payment:', apiRef);

//     if (!INTASEND_SECRET_KEY) {
//       return res.status(500).json({
//         success: false,
//         error: 'IntaSend secret key not configured'
//       });
//     }

//     const response = await axios.get(
//       `${INTASEND_API_URL}/checkout/?api_ref=${apiRef}`,
//       {
//         headers: {
//           'Authorization': `Bearer ${INTASEND_SECRET_KEY}`
//         }
//       }
//     );

//     const payment = response.data.results[0];
//     const verified = payment && payment.state === 'COMPLETE';

//     console.log('✅ Payment verification result:', {
//       verified,
//       state: payment?.state,
//       apiRef
//     });

//     res.json({
//       success: true,
//       verified,
//       payment
//     });

//   } catch (error) {
//     console.error('❌ Payment verification error:', {
//       status: error.response?.status,
//       data: error.response?.data,
//       message: error.message
//     });

//     res.status(500).json({
//       success: false,
//       error: error.response?.data?.message || error.message
//     });
//   }
// });

// // IntaSend Webhook (for real-time payment notifications)
// app.post('/api/intasend-webhook', async (req, res) => {
//   try {
//     const paymentData = req.body;

//     console.log('📩 IntaSend webhook received:', paymentData);

//     // TODO: Verify webhook signature for security
//     // const signature = req.headers['x-intasend-signature'];

//     if (paymentData.state === 'COMPLETE') {
//       const apiRef = paymentData.api_ref;
//       const parts = apiRef.split('-');
//       const tier = parts[0]; // PRO or SCHOOL
//       const userId = parts[1];

//       console.log(`✅ Payment successful for ${tier} tier, user: ${userId}`);
      
//       // TODO: Update Firestore subscription here
//       // You'll need Firebase Admin SDK for this
//     }

//     res.json({ received: true });

//   } catch (error) {
//     console.error('❌ Webhook error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// // Health check endpoint
// app.get('/api/health', (req, res) => {
//   res.json({ 
//     status: 'ok', 
//     intasend: INTASEND_PUBLISHABLE_KEY ? 'configured' : 'missing',
//     publishableKeyFormat: INTASEND_PUBLISHABLE_KEY ? INTASEND_PUBLISHABLE_KEY.substring(0, 15) + '...' : 'N/A',
//     timestamp: new Date().toISOString() 
//   });
// });

// // ============================================
// // END INTASEND ROUTES
// // ============================================

// app.listen(PORT, () => {
//   console.log(`🚀 Backend server running on http://localhost:${PORT}`);
//   console.log(`💳 IntaSend integration: ${INTASEND_PUBLISHABLE_KEY ? 'ACTIVE ✅' : 'NOT CONFIGURED ❌'}`);
//   console.log(`🌍 Using IntaSend ${INTASEND_PUBLISHABLE_KEY?.includes('_test_') ? 'SANDBOX (Test Mode)' : 'PRODUCTION (Live Mode)'}`);
//   console.log(`🔗 API URL: ${INTASEND_API_URL}`);
  
//   if (INTASEND_PUBLISHABLE_KEY) {
//     console.log(`🔑 Publishable key format: ${INTASEND_PUBLISHABLE_KEY.substring(0, 20)}...`);
//   }
// });


















// import express from 'express';
// import cors from 'cors';
// import { GoogleGenerativeAI } from '@google/generative-ai';
// import dotenv from 'dotenv';
// import axios from 'axios';

// dotenv.config();

// // FIXED: Remove VITE_ prefix for backend environment variables
// console.log('🔑 Gemini API Key loaded:', process.env.VITE_GEMINI_API_KEY ? 'YES ✅' : 'NO ❌');
// console.log('🔑 IntaSend Secret Key loaded:', process.env.VITE_INTASEND_SECRET_KEY ? 'YES ✅' : 'NO ❌');
// console.log('🔑 IntaSend Publishable Key loaded:', process.env.VITE_INTASEND_PUBLISHABLE_KEY ? 'YES ✅' : 'NO ❌');

// const app = express();
// const PORT = 3001;

// app.use(cors());
// app.use(express.json());

// // Gemini AI setup
// const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);

// // IntaSend configuration
// const INTASEND_SECRET_KEY = process.env.VITE_INTASEND_SECRET_KEY;
// const INTASEND_PUBLISHABLE_KEY = process.env.VITE_INTASEND_PUBLISHABLE_KEY;
// // FIXED: Correct API URL
// const INTASEND_API_URL = 'https://payment.intasend.com/api/v1';

// // Existing Claude/Gemini endpoint
// app.post('/api/claude', async (req, res) => {
//   try {
//     const { systemPrompt, userPrompt, maxTokens = 4096 } = req.body;

//     const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
//     const fullPrompt = `${systemPrompt}\n\nUser Query: ${userPrompt}`;

//     const result = await model.generateContent(fullPrompt);
//     const response = await result.response;
//     const text = response.text();

//     res.json({
//       content: [{ text: text }],
//       response: text
//     });
//   } catch (error) {
//     console.error('Gemini API Error:', error);
//     res.status(500).json({
//       error: {
//         message: error.message || 'Failed to get response from Gemini'
//       }
//     });
//   }
// });

// // ============================================
// // INTASEND PAYMENT ROUTES
// // ============================================

// // Create payment link
// app.post('/api/create-payment', async (req, res) => {
//   try {
//     const { amount, currency, email, firstName, lastName, apiRef, comment } = req.body;

//     console.log('📝 Creating payment:', { 
//       amount, 
//       currency, 
//       email, 
//       apiRef,
//       publishableKeyPresent: !!INTASEND_PUBLISHABLE_KEY
//     });

//     // Validate required fields
//     if (!amount || !currency || !email || !apiRef) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields: amount, currency, email, or apiRef'
//       });
//     }

//     // Check if publishable key is configured
//     if (!INTASEND_PUBLISHABLE_KEY) {
//       console.error('❌ IntaSend publishable key not configured!');
//       return res.status(500).json({
//         success: false,
//         error: 'IntaSend publishable key not configured on server'
//       });
//     }

//     // Create checkout session
//     const response = await axios.post(
//       `${INTASEND_API_URL}/checkout/`,
//       {
//         public_key: INTASEND_PUBLISHABLE_KEY, // Required in body
//         amount,
//         currency,
//         email,
//         first_name: firstName,
//         last_name: lastName,
//         api_ref: apiRef,
//         redirect_url: `${req.headers.origin || 'http://localhost:5173'}/payment-success`,
//         method: ['M-PESA', 'CARD', 'BANK'],
//         comment
//       },
//       {
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     console.log('✅ Payment created successfully:', {
//       url: response.data.url,
//       id: response.data.id
//     });

//     res.json({
//       success: true,
//       checkoutUrl: response.data.url,
//       paymentId: response.data.id
//     });

//   } catch (error) {
//     console.error('❌ IntaSend payment creation error:');
//     console.error('Status:', error.response?.status);
//     console.error('Status Text:', error.response?.statusText);
//     console.error('Error Data:', error.response?.data);
//     console.error('Error Message:', error.message); 
//     res.status(500).json({
//       success: false,
//       error: error.response?.data?.message || error.response?.data?.detail || error.message,
//       details: error.response?.data
//     });
//   }
// });

// // Verify payment
// app.post('/api/verify-payment', async (req, res) => {
//   try {
//     const { apiRef } = req.body;

//     console.log('🔍 Verifying payment:', apiRef);

//     if (!INTASEND_SECRET_KEY) {
//       return res.status(500).json({
//         success: false,
//         error: 'IntaSend secret key not configured'
//       });
//     }

//     const response = await axios.get(
//       `${INTASEND_API_URL}/checkout/?api_ref=${apiRef}`,
//       {
//         headers: {
//           'Authorization': `Bearer ${INTASEND_SECRET_KEY}`
//         }
//       }
//     );

//     const payment = response.data.results[0];
//     const verified = payment && payment.state === 'COMPLETE';

//     console.log('✅ Payment verification result:', {
//       verified,
//       state: payment?.state,
//       apiRef
//     });

//     res.json({
//       success: true,
//       verified,
//       payment
//     });

//   } catch (error) {
//     console.error('❌ Payment verification error:', {
//       status: error.response?.status,
//       data: error.response?.data,
//       message: error.message
//     });

//     res.status(500).json({
//       success: false,
//       error: error.response?.data?.message || error.message
//     });
//   }
// });

// // IntaSend Webhook (for real-time payment notifications)
// app.post('/api/intasend-webhook', async (req, res) => {
//   try {
//     const paymentData = req.body;

//     console.log('📩 IntaSend webhook received:', paymentData);

//     // TODO: Verify webhook signature for security
//     // const signature = req.headers['x-intasend-signature'];

//     if (paymentData.state === 'COMPLETE') {
//       const apiRef = paymentData.api_ref;
//       const parts = apiRef.split('-');
//       const tier = parts[0]; // PRO or SCHOOL
//       const userId = parts[1];

//       console.log(`✅ Payment successful for ${tier} tier, user: ${userId}`);
      
//       // TODO: Update Firestore subscription here
//       // You'll need Firebase Admin SDK for this
//     }

//     res.json({ received: true });

//   } catch (error) {
//     console.error('❌ Webhook error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// // Health check endpoint
// app.get('/api/health', (req, res) => {
//   res.json({ 
//     status: 'ok', 
//     intasend: INTASEND_PUBLISHABLE_KEY ? 'configured' : 'missing',
//     publishableKeyFormat: INTASEND_PUBLISHABLE_KEY ? INTASEND_PUBLISHABLE_KEY.substring(0, 15) + '...' : 'N/A',
//     timestamp: new Date().toISOString() 
//   });
// });

// // ============================================
// // END INTASEND ROUTES
// // ============================================

// app.listen(PORT, () => {
//   console.log(`🚀 Backend server running on http://localhost:${PORT}`);
//   console.log(`💳 IntaSend integration: ${INTASEND_PUBLISHABLE_KEY ? 'ACTIVE ✅' : 'NOT CONFIGURED ❌'}`);
  
//   if (INTASEND_PUBLISHABLE_KEY) {
//     console.log(`🔑 Publishable key format: ${INTASEND_PUBLISHABLE_KEY.substring(0, 20)}...`);
//   }
// });