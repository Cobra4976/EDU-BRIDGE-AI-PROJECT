// backend/subscriptionManager.js
import { db } from './firebaseAdmin.js';
import admin from './firebaseAdmin.js'; // ✅ FIXED: Import admin for Timestamp

/**
 * Activate Teacher Pro subscription
 */
export async function activateProSubscription(userId, paymentData) {
  try {
    console.log(`🎯 Activating Pro subscription for user: ${userId}`);
    
    const teacherRef = db.collection('teachers').doc(userId);
    
    // Check if teacher exists
    const teacherSnap = await teacherRef.get();
    if (!teacherSnap.exists) {
      console.error(`❌ Teacher profile not found for userId: ${userId}`);
      return { success: false, error: 'Teacher profile not found' };
    }
    
    // Set expiry to 30 days from now (monthly)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const updateData = {
      subscriptionTier: 'pro',
      subscriptionStatus: 'active',
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
      lastPaymentDate: admin.firestore.Timestamp.now(),
      intasendCustomerId: paymentData.account || paymentData.customer_id || null,
      updatedAt: new Date().toISOString()
    };

    await teacherRef.set(updateData, { merge: true });

    console.log(`✅ Activated Pro subscription for user ${userId}`, {
      expiry: expiryDate.toISOString(),
      tier: 'pro'
    });
    
    return { success: true, message: 'Pro subscription activated', data: updateData };

  } catch (error) {
    console.error('❌ Error activating Pro subscription:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Activate School License
 */
export async function activateSchoolSubscription(adminUserId, paymentData) {
  try {
    console.log(`🏫 Activating School subscription for admin: ${adminUserId}`);
    
    const teacherRef = db.collection('teachers').doc(adminUserId);
    
    // Check if teacher exists
    const teacherSnap = await teacherRef.get();
    if (!teacherSnap.exists) {
      console.error(`❌ Teacher profile not found for userId: ${adminUserId}`);
      return { success: false, error: 'Teacher profile not found' };
    }

    const teacherData = teacherSnap.data();
    
    // Set expiry to 365 days from now (yearly)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 365);

    // Create school document
    const schoolRef = db.collection('schools').doc();
    const schoolData = {
      schoolId: schoolRef.id,
      schoolName: teacherData.name ? `${teacherData.name}'s School` : 'School License',
      adminTeacherId: adminUserId,
      maxTeachers: 20,
      teacherIds: [adminUserId], // Admin is automatically added
      subscriptionStatus: 'active',
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
      intasendSubscriptionId: paymentData.id || paymentData.subscription_id || null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    await schoolRef.set(schoolData);

    // Update admin teacher profile
    const adminUpdateData = {
      subscriptionTier: 'school',
      subscriptionStatus: 'active',
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
      lastPaymentDate: admin.firestore.Timestamp.now(),
      schoolId: schoolRef.id,
      schoolRole: 'admin',
      intasendCustomerId: paymentData.account || paymentData.customer_id || null,
      updatedAt: new Date().toISOString()
    };

    await teacherRef.set(adminUpdateData, { merge: true });

    console.log(`✅ Activated School subscription for admin ${adminUserId}, school ID: ${schoolRef.id}`);
    
    return { 
      success: true, 
      message: 'School subscription activated', 
      schoolId: schoolRef.id,
      data: adminUpdateData
    };

  } catch (error) {
    console.error('❌ Error activating School subscription:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle subscription renewal (for recurring payments)
 */
export async function renewSubscription(userId, tier) {
  try {
    console.log(`🔄 Renewing ${tier} subscription for user: ${userId}`);
    
    const teacherRef = db.collection('teachers').doc(userId);
    const teacherDoc = await teacherRef.get();

    if (!teacherDoc.exists) {
      throw new Error('Teacher not found');
    }

    const teacherData = teacherDoc.data();
    const currentExpiry = teacherData.subscriptionExpiry?.toDate() || new Date();
    const newExpiry = new Date(currentExpiry);
    
    // If subscription already expired, start from today
    if (currentExpiry < new Date()) {
      newExpiry.setTime(new Date().getTime());
    }
    
    // Add 30 days for Pro, 365 days for School
    if (tier === 'pro') {
      newExpiry.setDate(newExpiry.getDate() + 30);
    } else if (tier === 'school') {
      newExpiry.setDate(newExpiry.getDate() + 365);
    }

    const updateData = {
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
      subscriptionStatus: 'active',
      lastPaymentDate: admin.firestore.Timestamp.now(),
      updatedAt: new Date().toISOString()
    };

    await teacherRef.update(updateData);

    // If school tier, also update school expiry
    if (tier === 'school' && teacherData.schoolId) {
      const schoolRef = db.collection('schools').doc(teacherData.schoolId);
      await schoolRef.update({
        subscriptionExpiry: admin.firestore.Timestamp.fromDate(newExpiry),
        subscriptionStatus: 'active',
        updatedAt: admin.firestore.Timestamp.now()
      });
    }

    console.log(`✅ Renewed ${tier} subscription for user ${userId}`, {
      newExpiry: newExpiry.toISOString()
    });
    
    return { success: true, message: 'Subscription renewed', data: updateData };

  } catch (error) {
    console.error('❌ Error renewing subscription:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle failed payment / expired subscription
 * Downgrades user to free tier
 */
export async function handleSubscriptionExpiry(userId) {
  try {
    console.log(`⚠️ Handling subscription expiry for user: ${userId}`);
    
    const teacherRef = db.collection('teachers').doc(userId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return { success: false, error: 'Teacher not found' };
    }

    const teacherData = teacherSnap.data();
    
    const updateData = {
      subscriptionStatus: 'expired',
      updatedAt: new Date().toISOString()
    };

    await teacherRef.update(updateData);

    // If was school admin, mark school as expired and downgrade all teachers
    if (teacherData.schoolRole === 'admin' && teacherData.schoolId) {
      const schoolRef = db.collection('schools').doc(teacherData.schoolId);
      await schoolRef.update({
        subscriptionStatus: 'expired',
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log(`⚠️ School ${teacherData.schoolId} marked as expired`);
    }

    console.log(`✅ Marked subscription as expired for user ${userId}`);
    
    return { success: true, message: 'Subscription marked as expired' };

  } catch (error) {
    console.error('❌ Error handling subscription expiry:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Downgrade user to free tier (payment failed or refund)
 */
export async function downgradeToFree(userId) {
  try {
    console.log(`⬇️ Downgrading user ${userId} to free tier`);

    const teacherRef = db.collection('teachers').doc(userId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return { success: false, error: 'Teacher not found' };
    }

    const teacherData = teacherSnap.data();

    const updateData = {
      subscriptionTier: 'free',
      subscriptionStatus: 'expired',
      subscriptionExpiry: null,
      schoolId: null,
      schoolRole: null,
      updatedAt: new Date().toISOString()
    };

    await teacherRef.update(updateData);

    // If was school admin, expire school and downgrade all teachers
    if (teacherData.schoolRole === 'admin' && teacherData.schoolId) {
      const schoolRef = db.collection('schools').doc(teacherData.schoolId);
      const schoolSnap = await schoolRef.get();

      if (schoolSnap.exists) {
        const schoolData = schoolSnap.data();

        // Update school status
        await schoolRef.update({
          subscriptionStatus: 'expired',
          updatedAt: admin.firestore.Timestamp.now()
        });

        // Downgrade all teachers in the school
        const batch = db.batch();
        for (const teacherId of schoolData.teacherIds || []) {
          if (teacherId !== userId) { // Skip admin, already updated
            const tRef = db.collection('teachers').doc(teacherId);
            batch.update(tRef, {
              subscriptionTier: 'free',
              subscriptionStatus: 'expired',
              subscriptionExpiry: null,
              schoolId: null,
              schoolRole: null,
              updatedAt: new Date().toISOString()
            });
          }
        }
        await batch.commit();

        console.log(`✅ Downgraded all ${schoolData.teacherIds.length} teachers in school ${teacherData.schoolId}`);
      }
    }

    console.log(`✅ User ${userId} downgraded to free tier`);

    return { success: true, message: 'Downgraded to free tier' };

  } catch (error) {
    console.error('❌ Error downgrading to free:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancel subscription (mark for cancellation but keep access until period end)
 */
export async function cancelSubscription(userId) {
  try {
    console.log(`🚫 Cancelling subscription for user: ${userId}`);

    const teacherRef = db.collection('teachers').doc(userId);
    const teacherSnap = await teacherRef.get();

    if (!teacherSnap.exists) {
      return { success: false, error: 'Teacher not found' };
    }

    await teacherRef.update({
      subscriptionStatus: 'cancelled',
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Subscription marked as cancelled for ${userId} (access until expiry)`);

    return { success: true, message: 'Subscription cancelled - access until current period ends' };

  } catch (error) {
    console.error('❌ Error cancelling subscription:', error);
    return { success: false, error: error.message };
  }
}




















