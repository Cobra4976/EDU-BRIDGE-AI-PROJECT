// backend/webhookValidator.js
import crypto from 'crypto';

/**
 * Verify IntaSend webhook signature
 * CRITICAL: Prevents malicious actors from faking webhook events
 * 
 * IntaSend signs webhooks using HMAC-SHA256
 */
export function verifyIntaSendSignature(signature, payload, secretKey) {
  try {
    if (!signature) {
      console.warn('⚠️ No signature provided');
      return false;
    }

    if (!secretKey) {
      console.error('❌ Secret key not configured');
      return false;
    }

    // Convert payload to string if it's an object
    const payloadString = typeof payload === 'string' 
      ? payload 
      : JSON.stringify(payload);

    // Create HMAC signature
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(payloadString);
    const calculatedSignature = hmac.digest('hex');

    // Compare signatures (timing-safe comparison)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(calculatedSignature)
    );

    if (isValid) {
      console.log('✅ Webhook signature verified');
    } else {
      console.error('❌ Invalid webhook signature!');
    }

    return isValid;

  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
}

/**
 * Middleware to verify IntaSend webhooks
 * Use this in your Express routes
 */
export function webhookVerificationMiddleware(secretKey) {
  return (req, res, next) => {
    const signature = req.headers['x-intasend-signature'];
    
    // In development, allow webhooks without signature
    if (process.env.NODE_ENV === 'development' && !signature) {
      console.warn('⚠️ Development mode: Webhook signature check skipped');
      return next();
    }

    // In production, reject webhooks without signature
    if (!signature) {
      console.error('❌ Webhook rejected: No signature');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const isValid = verifyIntaSendSignature(signature, req.body, secretKey);

    if (!isValid) {
      console.error('❌ Webhook rejected: Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Signature valid, proceed
    next();
  };
}

/**
 * Rate limiting for webhooks (prevent spam)
 */
const webhookAttempts = new Map();

export function rateLimitWebhook(apiRef, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const key = apiRef;

  if (!webhookAttempts.has(key)) {
    webhookAttempts.set(key, []);
  }

  const attempts = webhookAttempts.get(key);
  
  // Remove old attempts outside window
  const recentAttempts = attempts.filter(time => now - time < windowMs);
  
  if (recentAttempts.length >= maxAttempts) {
    console.warn(`⚠️ Rate limit exceeded for ${apiRef}`);
    return false;
  }

  recentAttempts.push(now);
  webhookAttempts.set(key, recentAttempts);

  return true;
}

/**
 * Clean up old rate limit data (run periodically)
 */
export function cleanupRateLimitData() {
  const now = Date.now();
  const maxAge = 3600000; // 1 hour

  for (const [key, attempts] of webhookAttempts.entries()) {
    const recent = attempts.filter(time => now - time < maxAge);
    
    if (recent.length === 0) {
      webhookAttempts.delete(key);
    } else {
      webhookAttempts.set(key, recent);
    }
  }

  console.log(`🧹 Cleaned up rate limit data. Active keys: ${webhookAttempts.size}`);
}

// Auto cleanup every hour
setInterval(cleanupRateLimitData, 3600000);