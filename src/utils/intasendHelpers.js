// src/utils/intasendHelpers.js

/**
 * IntaSend Payment Integration for EduBridge
 * Handles Teacher Pro and School License payments
 */

// Backend API URL - update this for production
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

/**
 * Initialize IntaSend payment for Teacher Pro ($2/month ≈ 270 KES)
 */
export async function initiateProPayment(teacherEmail, teacherName, teacherId) {
  try {
    console.log('🚀 Initiating Pro payment for:', teacherEmail);

    const response = await fetch(`${BACKEND_URL}/api/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 270, // 270 KES ≈ $2 USD
        currency: 'KES',
        email: teacherEmail,
        firstName: teacherName.split(' ')[0] || teacherName,
        lastName: teacherName.split(' ')[1] || 'Teacher',
        apiRef: `PRO-${teacherId}-${Date.now()}`, // Unique reference
        comment: 'EduBridge Teacher Pro - Monthly Subscription'
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Payment creation failed');
    }

    const data = await response.json();
    console.log('✅ Payment created:', data);

    return {
      success: true,
      checkoutUrl: data.checkoutUrl,
      paymentId: data.paymentId
    };

  } catch (error) {
    console.error('❌ Pro payment error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Initialize IntaSend payment for School License ($30/year ≈ 4000 KES)
 */
export async function initiateSchoolPayment(schoolEmail, schoolName, adminId) {
  try {
    console.log('🚀 Initiating School payment for:', schoolEmail);

    const response = await fetch(`${BACKEND_URL}/api/create-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: 4000, // 4000 KES ≈ $30 USD
        currency: 'KES',
        email: schoolEmail,
        firstName: schoolName,
        lastName: 'School',
        apiRef: `SCHOOL-${adminId}-${Date.now()}`,
        comment: 'EduBridge School License - Annual Subscription (20 Teachers)'
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Payment creation failed');
    }

    const data = await response.json();
    console.log('✅ Payment created:', data);

    return {
      success: true,
      checkoutUrl: data.checkoutUrl,
      paymentId: data.paymentId
    };

  } catch (error) {
    console.error('❌ School payment error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify payment status (call this after redirect back from IntaSend)
 */
export async function verifyPayment(apiRef) {
  try {
    console.log('🔍 Verifying payment:', apiRef);

    const response = await fetch(`${BACKEND_URL}/api/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiRef })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Payment verification failed');
    }

    const data = await response.json();
    console.log('✅ Payment verified:', data);

    return {
      success: true,
      verified: data.verified,
      payment: data.payment
    };

  } catch (error) {
    console.error('❌ Verification error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle payment callback after user returns from IntaSend
 * Call this on your payment success page
 */
export async function handlePaymentCallback() {
  // Get payment reference from URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const apiRef = urlParams.get('api_ref') || urlParams.get('apiRef');

  if (!apiRef) {
    return {
      success: false,
      error: 'No payment reference found in URL'
    };
  }

  // Verify the payment with backend
  return await verifyPayment(apiRef);
}

/**
 * Currency conversion helper (approximate rates)
 */
export function convertToLocalCurrency(usdAmount, country) {
  const rates = {
    'Kenya': { currency: 'KES', rate: 135 },
    'Uganda': { currency: 'UGX', rate: 3700 },
    'Tanzania': { currency: 'TZS', rate: 2500 },
    'Rwanda': { currency: 'RWF', rate: 1250 },
    'Nigeria': { currency: 'NGN', rate: 1500 },
    'Ghana': { currency: 'GHS', rate: 12 },
    'South Africa': { currency: 'ZAR', rate: 18 },
    'Ethiopia': { currency: 'ETB', rate: 110 }
  };

  const countryData = rates[country] || { currency: 'USD', rate: 1 };
  const localAmount = Math.ceil(usdAmount * countryData.rate);

  return {
    amount: localAmount,
    currency: countryData.currency,
    formatted: `${countryData.currency} ${localAmount.toLocaleString()}`
  };
}