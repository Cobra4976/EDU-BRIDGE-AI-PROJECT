// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const mpesaService = require('../services/mpesaService');
const admin = require('firebase-admin');

// Initialize Firebase Admin (if not already done in your main server file)
// Make sure to do this only once in your app
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

// Store for tracking pending transactions (in production, use Redis or database)
const pendingTransactions = new Map();

/**
 * POST /api/payment/mpesa/initiate
 * Initiate M-Pesa payment
 */
router.post('/mpesa/initiate', async (req, res) => {
  try {
    const { phoneNumber, amount, userId, subscriptionTier } = req.body;

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

      // Store in pending transactions map
      pendingTransactions.set(result.checkoutRequestId, {
        transactionId,
        userId,
        subscriptionTier: subscriptionTier || 'premium'
      });

      // Auto-expire after 2 minutes
      setTimeout(() => {
        pendingTransactions.delete(result.checkoutRequestId);
      }, 120000);

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
    console.error('Payment initiation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/payment/mpesa/callback
 * M-Pesa callback endpoint
 */
router.post('/mpesa/callback', async (req, res) => {
  try {
    console.log('M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

    // Process callback
    const result = mpesaService.processCallback(req.body);

    // Find transaction
    const transactionQuery = await db.collection('transactions')
      .where('checkoutRequestId', '==', result.checkoutRequestId)
      .limit(1)
      .get();

    if (transactionQuery.empty) {
      console.error('Transaction not found for checkout:', result.checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const transactionDoc = transactionQuery.docs[0];
    const transactionData = transactionDoc.data();

    if (result.success) {
      // Payment successful
      console.log('Payment successful:', result);

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
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        )
      });

      console.log('Subscription upgraded for user:', transactionData.userId);

    } else {
      // Payment failed
      console.log('Payment failed:', result);

      await transactionDoc.ref.update({
        status: 'failed',
        error: result.errorMessage || result.resultDesc,
        resultCode: result.resultCode,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Clean up pending transactions
    pendingTransactions.delete(result.checkoutRequestId);

    // Respond to M-Pesa
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  } catch (error) {
    console.error('Callback processing error:', error);
    return res.json({ ResultCode: 1, ResultDesc: 'Failed' });
  }
});

/**
 * POST /api/payment/mpesa/timeout
 * M-Pesa timeout callback
 */
router.post('/mpesa/timeout', async (req, res) => {
  console.log('M-Pesa Timeout:', JSON.stringify(req.body, null, 2));
  
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

    pendingTransactions.delete(CheckoutRequestID);

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Timeout processing error:', error);
    return res.json({ ResultCode: 1, ResultDesc: 'Failed' });
  }
});

/**
 * GET /api/payment/mpesa/status/:transactionId
 * Check payment status
 */
router.get('/mpesa/status/:transactionId', async (req, res) => {
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
        if (result.resultCode === '0') {
          transaction.status = 'completed';
        } else if (result.resultCode === '1032') {
          transaction.status = 'cancelled';
        } else {
          transaction.status = 'failed';
        }

        await transactionDoc.ref.update({
          status: transaction.status,
          resultCode: result.resultCode,
          resultDesc: result.resultDesc,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
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
    console.error('Status check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;