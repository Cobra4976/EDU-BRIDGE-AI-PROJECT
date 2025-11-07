import { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup
  
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../server/firebase.js';
import StudentDashboard from './components/StudentDashboard';
import TeacherDashboard from './components/TeacherDashboard';
import './index.css';

// --- Full lists ---
const AFRICAN_COUNTRIES = [
  'Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cameroon','Cape Verde',
  'Central African Republic','Chad','Comoros','Republic of the Congo','Democratic Republic of the Congo',
  'Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana',
  'Guinea','Guinea-Bissau','Ivory Coast','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi',
  'Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda',
  'Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan',
  'Sudan','Tanzania','Togo','Tunisia','Uganda','Zambia','Zimbabwe'
];

const EDUCATIONAL_SYSTEMS = [
  'CBC - Competency Based Curriculum (Kenya)',
   'CBC - Competency Based Curriculum (Tanzania)',
    'CBC - Competency Based Curriculum (Uganda)',
  '8-4-4 System (Kenya - legacy)',
  '6-3-3-4 System (Nigeria)',
  'Universal Basic Education (UBE)',
  'CAPS - Curriculum and Assessment Policy Statements (South Africa)',
  'WAEC / WASSCE (West Africa)',
  'NECO (Nigeria)',
  'Matric / NSC (South Africa)',
  'IB - International Baccalaureate',
  'IGCSE / Cambridge International',
  'A-Levels (British)',
  'American Curriculum (US)',
  'French Baccalauréat (Francophone)',
  'Thanaweya Amma (Egypt)',
  'National Curriculum (country-specific)',
  'Technical/Vocational Pathways',
];

const AFRICAN_LANGUAGES = [
  'English','French','Arabic','Swahili','Hausa','Amharic','Yoruba','Igbo','Portuguese',
  'Akan (Twi)','Oromo','Shona','Zulu','Xhosa','Wolof','Kinyarwanda','Kirundi','Sesotho',
  'Tswana','Tigrinya','Somali','Berber (Tamazight)','Afrikaans','Lingala','Fula','Chichewa'
];

export default function AuthApp() {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [selectedRoleForProfile, setSelectedRoleForProfile] = useState('');
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);

  const [studentData, setStudentData] = useState({
    name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '', languageProficiency: ''
  });
  const [teacherData, setTeacherData] = useState({
    name: '', country: '', educationalSystem: '', subjectArea: '', contactInfo: ''
  });

  // --- Auth listener ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const profileData = userDoc.data();
            setUserRole(profileData.role || '');

            // ✅ Fetch profile from correct collection
            if (profileData.role === 'teacher') {
              const teacherDoc = await getDoc(doc(db, 'teachers', currentUser.uid));
              if (teacherDoc.exists()) {
                setUserProfile(teacherDoc.data());
                setStep(1);
              } else {
                setUserProfile(null);
                setStep(3);
                setSelectedRoleForProfile('teacher');
              }
            } else if (profileData.role === 'student') {
              const studentDoc = await getDoc(doc(db, 'students', currentUser.uid));
              if (studentDoc.exists()) {
                setUserProfile(studentDoc.data());
                setStep(1);
              } else {
                setUserProfile(null);
                setStep(3);
                setSelectedRoleForProfile('student');
              }
            } else {
              setStep(2);
            }
          } else {
            setStep(2);
          }
        } catch (err) {
          console.error('Error fetching user doc:', err);
        }
      } else {
        setUser(null);
        setUserRole('');
        setUserProfile(null);
        setStep(1);
      }
      setInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Auth actions ---
  const handleAuth = async () => {
    setError('');
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', credential.user.uid), {
          email: credential.user.email,
          role: '',
          createdAt: new Date().toISOString()
        });
        setStep(2);
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') setError('Email already registered.');
      else if (err.code === 'auth/wrong-password') setError('Wrong password.');
      else if (err.code === 'auth/user-not-found') setError('No account found.');
      else setError('Authentication failed.');
    } finally {
      setLoading(false);
    }
  };
  const handleGoogleSignIn = async () => {
  setError('');
  setLoading(true);
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Check if user document exists
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // New user - create basic user document
      await setDoc(userDocRef, {
        email: user.email,
        role: '',
        createdAt: new Date().toISOString()
      });
      setStep(2); // Go to role selection
    }
    // If user exists, onAuthStateChanged will handle the rest
  } catch (err) {
    console.error('Google sign-in error:', err);
    if (err.code === 'auth/popup-closed-by-user') {
      setError('Sign-in cancelled.');
    } else if (err.code === 'auth/popup-blocked') {
      setError('Popup blocked. Please allow popups for this site.');
    } else {
      setError('Google sign-in failed. Please try again.');
    }
  } finally {
    setLoading(false);
  }
};



  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email to reset password.');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetEmailSent(true);
    } catch {
      setError('Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleSelection = async (chosenRole) => {
    setError('');
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('User not authenticated.');

      await setDoc(doc(db, 'users', uid), { role: chosenRole }, { merge: true });
      setSelectedRoleForProfile(chosenRole);
      setStep(3);
      setRole(chosenRole);
    } catch (err) {
      console.error('Failed to save role:', err);
      setError('Failed to save role. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const uid = user?.uid;
      if (!uid) throw new Error('User not authenticated.');

      let profilePayload = {};
      let collection = '';

      if (selectedRoleForProfile === 'student') {
        const values = Object.values(studentData);
        if (values.some(v => !String(v || '').trim())) {
          setError('Please fill all student fields.');
          setLoading(false);
          return;
        }
        profilePayload = { email, role: 'student', ...studentData, createdAt: new Date().toISOString() };
        collection = 'students';
      } else {
        const values = Object.values(teacherData);
        if (values.some(v => !String(v || '').trim())) {
          setError('Please fill all teacher fields.');
          setLoading(false);
          return;
        }
        profilePayload = { email, role: 'teacher', ...teacherData, createdAt: new Date().toISOString() };
        collection = 'teachers';
      }

      await setDoc(doc(db, collection, uid), profilePayload, { merge: true });
      await setDoc(doc(db, 'users', uid), { email, role: selectedRoleForProfile }, { merge: true });

      setUserRole(profilePayload.role);
      setUserProfile(profilePayload);
      setStep(1);
    } catch (err) {
      console.error(err);
      setError('Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setUserRole('');
    setUserProfile(null);
    setEmail('');
    setPassword('');
    setStep(1);
  };
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
    if (currentUser) {
      try {
        // Existing fetch logic
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        // ... rest of your code
      } catch (error) {
        // Handle offline gracefully
        if (error.code === 'unavailable') {
          console.log('📴 Offline: Loading from cache');
          // Your app will still work with cached data
        } else {
          console.error('Error fetching user doc:', error);
        }
      }
    }
    setLoading(false);
  });

  return () => unsubscribe();
}, []);


  // --- Theming ---
  const bg = "bg-[#f9fdf9]";
  const card = "bg-white border border-green-100 shadow-lg";
  const text = "text-[#1b1b1b]";
  const accent = "bg-[#2e7d32] hover:bg-[#43a047] text-white";
  const heading = "text-[#2e7d32]";
  const inputBase = "w-full mb-4 px-3 py-2 rounded border border-green-200 focus:outline-none focus:ring-2 focus:ring-[#43a047] bg-white text-[#1b1b1b]";

  // --- Initial Welcome screen ---
  if (showWelcome) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg} px-6`}>
        <div className={`max-w-xl ${card} p-8 rounded-xl text-center`}>
          <h1 className="text-3xl font-bold mb-4 text-[#2e7d32]">Welcome to EduBridge Africa</h1>
          <p className="text-gray-700 mb-6">
            EduBridge Africa is a web application designed to connect teachers and students across Africa, helping learners access tailored educational resources and support. Please login or sign up with your email to continue.
          </p>
          <button
            className={`px-6 py-3 rounded ${accent}`}
            onClick={() => setShowWelcome(false)}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // --- Loading state ---
  if (initializing) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg}`}>
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#2e7d32] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className={`${text}`}>Loading...</div>
        </div>
      </div>
    );
  }

  // --- Dashboard routing ---
  if (user && userProfile && userRole === 'student')
    return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
  if (user && userProfile && userRole === 'teacher')
    return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;

  // --- Step 1: Auth screen ---
  if (!user && step === 1) {
    return (
      <div className={`flex justify-center items-center min-h-screen ${bg}`}>
        <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
          <h2 className={`text-3xl font-semibold text-center mb-6 ${heading}`}>
            {isLogin ? 'Sign In' : 'Sign Up'}
          </h2>
          {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
          {resetEmailSent && <div className="bg-green-50 text-green-700 px-3 py-2 rounded mb-4 text-sm">Password reset email sent!</div>}

          <label>Email address</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputBase} placeholder="Enter email" />
          <label>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className={inputBase} placeholder="Enter password" />

          {!isLogin && (
            <>
              <label>I am a</label>
              <select value={role} onChange={e=>setRole(e.target.value)} className={inputBase}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </>
          )}

          <div className="flex justify-between mb-4 text-sm">
            <button onClick={handleForgotPassword} className="text-[#2e7d32] hover:underline">Forgot password?</button>
          </div>

          
          <button onClick={handleAuth} disabled={loading} className={`w-full py-2 rounded ${accent}`}>
  {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Continue'}
</button>

<div className="flex items-center my-4">
  <div className="flex-1 border-t border-green-200"></div>
  <span className="px-4 text-gray-500 text-sm">or</span>
  <div className="flex-1 border-t border-green-200"></div>
</div>

<button
  onClick={handleGoogleSignIn}
  disabled={loading}
  className="w-full py-2 rounded border-2 border-green-200 hover:bg-green-50 text-[#1b1b1b] transition flex items-center justify-center gap-2"
>
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
  {loading ? 'Processing...' : 'Continue with Google'}
</button>

<p className="text-center mt-4"></p>
<p className="text-center mt-4">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button onClick={()=>{setIsLogin(!isLogin); setError(''); setResetEmailSent(false);}} className="text-[#2e7d32] ml-2 underline">
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // --- Step 2: Role selection ---
  if (user && step === 2) {
    return (
      <div className={`flex justify-center items-center min-h-screen ${bg}`}>
        <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
          <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>Select Your Role</h2>
          {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
          <div className="flex justify-around mb-6">
            <button onClick={()=>handleRoleSelection('student')} className={`px-4 py-2 rounded w-32 ${accent}`}>Student</button>
            <button onClick={()=>handleRoleSelection('teacher')} className={`px-4 py-2 rounded w-32 ${accent}`}>Teacher</button>
          </div>
          <button onClick={()=>setStep(1)} className="w-full py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition">Back</button>
        </div>
      </div>
    );
  }

  // --- Step 3: Complete profile ---
  if (step === 3 && selectedRoleForProfile) {
    const isStudent = selectedRoleForProfile === 'student';
    return (
      <div className={`flex justify-center items-center min-h-screen ${bg}`}>
        <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
          <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>
            {isStudent ? 'Student Profile' : 'Teacher Profile'}
          </h2>
          {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
          {isStudent ? (
            <>
              <label>Full Name</label>
              <input type="text" value={studentData.name} onChange={e=>setStudentData({...studentData, name:e.target.value})} className={inputBase} />
              <label>Country</label>
              <select value={studentData.country} onChange={e=>setStudentData({...studentData, country:e.target.value})} className={inputBase}>
                <option value="">Select country</option>
                {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
              </select>
              <label>Educational System</label>
              <select value={studentData.educationalSystem} onChange={e=>setStudentData({...studentData, educationalSystem:e.target.value})} className={inputBase}>
                <option value="">Select system</option>
                {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
              </select>
              <label>Language</label>
              <select value={studentData.languageProficiency} onChange={e=>setStudentData({...studentData, languageProficiency:e.target.value})} className={inputBase}>
                <option value="">Select language</option>
                {AFRICAN_LANGUAGES.map(l=><option key={l}>{l}</option>)}
              </select>
              <label>Strengths</label>
              <textarea value={studentData.strengths} onChange={e=>setStudentData({...studentData, strengths:e.target.value})} className={inputBase} rows={3}/>
                            <label>Areas for Improvement</label>
              <textarea
                value={studentData.weaknesses}
                onChange={e => setStudentData({ ...studentData, weaknesses: e.target.value })}
                className={inputBase}
                rows={3}
              />

              <button
                onClick={handleProfileSubmit}
                disabled={loading}
                className={`w-full py-2 mt-4 rounded ${accent}`}
              >
                {loading ? 'Saving...' : 'Save Profile'}
              </button>
            </>
          ) : (
            <>
              <label>Full Name</label>
              <input
                type="text"
                value={teacherData.name}
                onChange={e => setTeacherData({ ...teacherData, name: e.target.value })}
                className={inputBase}
              />
              <label>Country</label>
              <select
                value={teacherData.country}
                onChange={e => setTeacherData({ ...teacherData, country: e.target.value })}
                className={inputBase}
              >
                <option value="">Select country</option>
                {AFRICAN_COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <label>Educational System</label>
              <select
                value={teacherData.educationalSystem}
                onChange={e => setTeacherData({ ...teacherData, educationalSystem: e.target.value })}
                className={inputBase}
              >
                <option value="">Select system</option>
                {EDUCATIONAL_SYSTEMS.map(s => <option key={s}>{s}</option>)}
              </select>
              <label>Subject Area</label>
              <input
                type="text"
                value={teacherData.subjectArea}
                onChange={e => setTeacherData({ ...teacherData, subjectArea: e.target.value })}
                className={inputBase}
              />
              <label>Contact Info</label>
              <input
                type="text"
                value={teacherData.contactInfo}
                onChange={e => setTeacherData({ ...teacherData, contactInfo: e.target.value })}
                className={inputBase}
              />

              <button
                onClick={handleProfileSubmit}
                disabled={loading}
                className={`w-full py-2 mt-4 rounded ${accent}`}
              >
                {loading ? 'Saving...' : 'Save Profile'}
              </button>
            </>
          )}

          <button
            onClick={() => setStep(2)}
            className="w-full py-2 mt-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // --- Fallback ---
  return (
    <div className={`min-h-screen flex items-center justify-center ${bg}`}>
      <p className={`${text}`}>Loading</p>
    </div>
  );
}































// import { useState, useEffect } from 'react';
// import {
//   createUserWithEmailAndPassword,
//   signInWithEmailAndPassword,
//   onAuthStateChanged,
//   signOut,
//   sendPasswordResetEmail
// } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';
// import './index.css';

// // --- Full lists ---
// const AFRICAN_COUNTRIES = [
//   'Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cameroon','Cape Verde',
//   'Central African Republic','Chad','Comoros','Republic of the Congo','Democratic Republic of the Congo',
//   'Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana',
//   'Guinea','Guinea-Bissau','Ivory Coast','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi',
//   'Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda',
//   'Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan',
//   'Sudan','Tanzania','Togo','Tunisia','Uganda','Zambia','Zimbabwe'
// ];

// const EDUCATIONAL_SYSTEMS = [
//   'CBC - Competency Based Curriculum (Kenya)',
//   '8-4-4 System (Kenya - legacy)',
//   '6-3-3-4 System (Nigeria)',
//   'Universal Basic Education (UBE)',
//   'CAPS - Curriculum and Assessment Policy Statements (South Africa)',
//   'WAEC / WASSCE (West Africa)',
//   'NECO (Nigeria)',
//   'Matric / NSC (South Africa)',
//   'IB - International Baccalaureate',
//   'IGCSE / Cambridge International',
//   'A-Levels (British)',
//   'American Curriculum (US)',
//   'French Baccalauréat (Francophone)',
//   'Thanaweya Amma (Egypt)',
//   'National Curriculum (country-specific)',
//   'Technical/Vocational Pathways',
// ];

// const AFRICAN_LANGUAGES = [
//   'English','French','Arabic','Swahili','Hausa','Amharic','Yoruba','Igbo','Portuguese',
//   'Akan (Twi)','Oromo','Shona','Zulu','Xhosa','Wolof','Kinyarwanda','Kirundi','Sesotho',
//   'Tswana','Tigrinya','Somali','Berber (Tamazight)','Afrikaans','Lingala','Fula','Chichewa'
// ];

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [selectedRoleForProfile, setSelectedRoleForProfile] = useState('');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);
//   const [error, setError] = useState('');
//   const [resetEmailSent, setResetEmailSent] = useState(false);
//   const [showWelcome, setShowWelcome] = useState(true);

//   const [studentData, setStudentData] = useState({
//     name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '', languageProficiency: ''
//   });
//   const [teacherData, setTeacherData] = useState({
//     name: '', country: '', educationalSystem: '', subjectArea: '', contactInfo: ''
//   });

//   // --- Auth listener ---
//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         try {
//           const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//           if (userDoc.exists()) {
//             const profileData = userDoc.data();
//             setUserRole(profileData.role || '');

//             // ✅ Fetch profile from correct collection
//             if (profileData.role === 'teacher') {
//               const teacherDoc = await getDoc(doc(db, 'teachers', currentUser.uid));
//               if (teacherDoc.exists()) {
//                 setUserProfile(teacherDoc.data());
//                 setStep(1);
//               } else {
//                 setUserProfile(null);
//                 setStep(3);
//                 setSelectedRoleForProfile('teacher');
//               }
//             } else if (profileData.role === 'student') {
//               const studentDoc = await getDoc(doc(db, 'students', currentUser.uid));
//               if (studentDoc.exists()) {
//                 setUserProfile(studentDoc.data());
//                 setStep(1);
//               } else {
//                 setUserProfile(null);
//                 setStep(3);
//                 setSelectedRoleForProfile('student');
//               }
//             } else {
//               setStep(2);
//             }
//           } else {
//             setStep(2);
//           }
//         } catch (err) {
//           console.error('Error fetching user doc:', err);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//         setStep(1);
//       }
//       setInitializing(false);
//     });
//     return () => unsubscribe();
//   }, []);

//   // --- Auth actions ---
//   const handleAuth = async () => {
//     setError('');
//     if (!email || !password) {
//       setError('Please fill in both email and password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       if (isLogin) {
//         await signInWithEmailAndPassword(auth, email, password);
//       } else {
//         const credential = await createUserWithEmailAndPassword(auth, email, password);
//         await setDoc(doc(db, 'users', credential.user.uid), {
//           email: credential.user.email,
//           role: '',
//           createdAt: new Date().toISOString()
//         });
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') setError('Email already registered.');
//       else if (err.code === 'auth/wrong-password') setError('Wrong password.');
//       else if (err.code === 'auth/user-not-found') setError('No account found.');
//       else setError('Authentication failed.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotPassword = async () => {
//     if (!email) {
//       setError('Enter your email to reset password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       await sendPasswordResetEmail(auth, email);
//       setResetEmailSent(true);
//     } catch {
//       setError('Failed to send reset email.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleRoleSelection = async (chosenRole) => {
//     setError('');
//     setLoading(true);
//     try {
//       const uid = auth.currentUser?.uid;
//       if (!uid) throw new Error('User not authenticated.');

//       await setDoc(doc(db, 'users', uid), { role: chosenRole }, { merge: true });
//       setSelectedRoleForProfile(chosenRole);
//       setStep(3);
//       setRole(chosenRole);
//     } catch (err) {
//       console.error('Failed to save role:', err);
//       setError('Failed to save role. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);
//     try {
//       const uid = user?.uid;
//       if (!uid) throw new Error('User not authenticated.');

//       let profilePayload = {};
//       let collection = '';

//       if (selectedRoleForProfile === 'student') {
//         const values = Object.values(studentData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all student fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'student', ...studentData, createdAt: new Date().toISOString() };
//         collection = 'students';
//       } else {
//         const values = Object.values(teacherData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all teacher fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'teacher', ...teacherData, createdAt: new Date().toISOString() };
//         collection = 'teachers';
//       }

//       await setDoc(doc(db, collection, uid), profilePayload, { merge: true });
//       await setDoc(doc(db, 'users', uid), { email, role: selectedRoleForProfile }, { merge: true });

//       setUserRole(profilePayload.role);
//       setUserProfile(profilePayload);
//       setStep(1);
//     } catch (err) {
//       console.error(err);
//       setError('Failed to save profile.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     await signOut(auth);
//     setUser(null);
//     setUserRole('');
//     setUserProfile(null);
//     setEmail('');
//     setPassword('');
//     setStep(1);
//   };
// useEffect(() => {
//   const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//     if (currentUser) {
//       try {
//         // Existing fetch logic
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         // ... rest of your code
//       } catch (error) {
//         // Handle offline gracefully
//         if (error.code === 'unavailable') {
//           console.log('📴 Offline: Loading from cache');
//           // Your app will still work with cached data
//         } else {
//           console.error('Error fetching user doc:', error);
//         }
//       }
//     }
//     setLoading(false);
//   });

//   return () => unsubscribe();
// }, []);


//   // --- Theming ---
//   const bg = "bg-[#f9fdf9]";
//   const card = "bg-white border border-green-100 shadow-lg";
//   const text = "text-[#1b1b1b]";
//   const accent = "bg-[#2e7d32] hover:bg-[#43a047] text-white";
//   const heading = "text-[#2e7d32]";
//   const inputBase = "w-full mb-4 px-3 py-2 rounded border border-green-200 focus:outline-none focus:ring-2 focus:ring-[#43a047] bg-white text-[#1b1b1b]";

//   // --- Initial Welcome screen ---
//   if (showWelcome) {
//     return (
//       <div className={`min-h-screen flex items-center justify-center ${bg} px-6`}>
//         <div className={`max-w-xl ${card} p-8 rounded-xl text-center`}>
//           <h1 className="text-3xl font-bold mb-4 text-[#2e7d32]">Welcome to EduBridge Africa</h1>
//           <p className="text-gray-700 mb-6">
//             EduBridge Africa is a web application designed to connect teachers and students across Africa, helping learners access tailored educational resources and support. Please login or sign up with your email to continue.
//           </p>
//           <button
//             className={`px-6 py-3 rounded ${accent}`}
//             onClick={() => setShowWelcome(false)}
//           >
//             Continue
//           </button>
//         </div>
//       </div>
//     );
//   }

//   // --- Loading state ---
//   if (initializing) {
//     return (
//       <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//         <div className="text-center">
//           <div className="w-16 h-16 border-4 border-[#2e7d32] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <div className={`${text}`}>Loading...</div>
//         </div>
//       </div>
//     );
//   }

//   // --- Dashboard routing ---
//   if (user && userProfile && userRole === 'student')
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   if (user && userProfile && userRole === 'teacher')
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;

//   // --- Step 1: Auth screen ---
//   if (!user && step === 1) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-3xl font-semibold text-center mb-6 ${heading}`}>
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {resetEmailSent && <div className="bg-green-50 text-green-700 px-3 py-2 rounded mb-4 text-sm">Password reset email sent!</div>}

//           <label>Email address</label>
//           <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputBase} placeholder="Enter email" />
//           <label>Password</label>
//           <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className={inputBase} placeholder="Enter password" />

//           {!isLogin && (
//             <>
//               <label>I am a</label>
//               <select value={role} onChange={e=>setRole(e.target.value)} className={inputBase}>
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </>
//           )}

//           <div className="flex justify-between mb-4 text-sm">
//             <button onClick={handleForgotPassword} className="text-[#2e7d32] hover:underline">Forgot password?</button>
//           </div>

//           <button onClick={handleAuth} disabled={loading} className={`w-full py-2 rounded ${accent}`}>
//             {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Continue'}
//           </button>

//           <p className="text-center mt-4">
//             {isLogin ? "Don't have an account?" : "Already have an account?"}
//             <button onClick={()=>{setIsLogin(!isLogin); setError(''); setResetEmailSent(false);}} className="text-[#2e7d32] ml-2 underline">
//               {isLogin ? 'Sign Up' : 'Sign In'}
//             </button>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   // --- Step 2: Role selection ---
//   if (user && step === 2) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>Select Your Role</h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           <div className="flex justify-around mb-6">
//             <button onClick={()=>handleRoleSelection('student')} className={`px-4 py-2 rounded w-32 ${accent}`}>Student</button>
//             <button onClick={()=>handleRoleSelection('teacher')} className={`px-4 py-2 rounded w-32 ${accent}`}>Teacher</button>
//           </div>
//           <button onClick={()=>setStep(1)} className="w-full py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition">Back</button>
//         </div>
//       </div>
//     );
//   }

//   // --- Step 3: Complete profile ---
//   if (step === 3 && selectedRoleForProfile) {
//     const isStudent = selectedRoleForProfile === 'student';
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>
//             {isStudent ? 'Student Profile' : 'Teacher Profile'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {isStudent ? (
//             <>
//               <label>Full Name</label>
//               <input type="text" value={studentData.name} onChange={e=>setStudentData({...studentData, name:e.target.value})} className={inputBase} />
//               <label>Country</label>
//               <select value={studentData.country} onChange={e=>setStudentData({...studentData, country:e.target.value})} className={inputBase}>
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select value={studentData.educationalSystem} onChange={e=>setStudentData({...studentData, educationalSystem:e.target.value})} className={inputBase}>
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
//               </select>
//               <label>Language</label>
//               <select value={studentData.languageProficiency} onChange={e=>setStudentData({...studentData, languageProficiency:e.target.value})} className={inputBase}>
//                 <option value="">Select language</option>
//                 {AFRICAN_LANGUAGES.map(l=><option key={l}>{l}</option>)}
//               </select>
//               <label>Strengths</label>
//               <textarea value={studentData.strengths} onChange={e=>setStudentData({...studentData, strengths:e.target.value})} className={inputBase} rows={3}/>
//                             <label>Areas for Improvement</label>
//               <textarea
//                 value={studentData.weaknesses}
//                 onChange={e => setStudentData({ ...studentData, weaknesses: e.target.value })}
//                 className={inputBase}
//                 rows={3}
//               />

//               <button
//                 onClick={handleProfileSubmit}
//                 disabled={loading}
//                 className={`w-full py-2 mt-4 rounded ${accent}`}
//               >
//                 {loading ? 'Saving...' : 'Save Profile'}
//               </button>
//             </>
//           ) : (
//             <>
//               <label>Full Name</label>
//               <input
//                 type="text"
//                 value={teacherData.name}
//                 onChange={e => setTeacherData({ ...teacherData, name: e.target.value })}
//                 className={inputBase}
//               />
//               <label>Country</label>
//               <select
//                 value={teacherData.country}
//                 onChange={e => setTeacherData({ ...teacherData, country: e.target.value })}
//                 className={inputBase}
//               >
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c => <option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select
//                 value={teacherData.educationalSystem}
//                 onChange={e => setTeacherData({ ...teacherData, educationalSystem: e.target.value })}
//                 className={inputBase}
//               >
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s => <option key={s}>{s}</option>)}
//               </select>
//               <label>Subject Area</label>
//               <input
//                 type="text"
//                 value={teacherData.subjectArea}
//                 onChange={e => setTeacherData({ ...teacherData, subjectArea: e.target.value })}
//                 className={inputBase}
//               />
//               <label>Contact Info</label>
//               <input
//                 type="text"
//                 value={teacherData.contactInfo}
//                 onChange={e => setTeacherData({ ...teacherData, contactInfo: e.target.value })}
//                 className={inputBase}
//               />

//               <button
//                 onClick={handleProfileSubmit}
//                 disabled={loading}
//                 className={`w-full py-2 mt-4 rounded ${accent}`}
//               >
//                 {loading ? 'Saving...' : 'Save Profile'}
//               </button>
//             </>
//           )}

//           <button
//             onClick={() => setStep(2)}
//             className="w-full py-2 mt-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition"
//           >
//             Back
//           </button>
//         </div>
//       </div>
//     );
//   }

//   // --- Fallback ---
//   return (
//     <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//       <p className={`${text}`}>Unexpected state. Please reload.</p>
//     </div>
//   );
// }


              


























// import { useState, useEffect } from 'react';
// import {
//   createUserWithEmailAndPassword,
//   signInWithEmailAndPassword,
//   onAuthStateChanged,
//   signOut,
//   sendPasswordResetEmail
// } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';
// import './index.css';

// // --- Full lists ---
// const AFRICAN_COUNTRIES = [
//   'Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cameroon','Cape Verde',
//   'Central African Republic','Chad','Comoros','Republic of the Congo','Democratic Republic of the Congo',
//   'Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana',
//   'Guinea','Guinea-Bissau','Ivory Coast','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi',
//   'Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda',
//   'Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan',
//   'Sudan','Tanzania','Togo','Tunisia','Uganda','Zambia','Zimbabwe'
// ];

// const EDUCATIONAL_SYSTEMS = [
//   'CBC - Competency Based Curriculum (Kenya)',
//   '8-4-4 System (Kenya - legacy)',
//   '6-3-3-4 System (Nigeria)',
//   'Universal Basic Education (UBE)',
//   'CAPS - Curriculum and Assessment Policy Statements (South Africa)',
//   'WAEC / WASSCE (West Africa)',
//   'NECO (Nigeria)',
//   'Matric / NSC (South Africa)',
//   'IB - International Baccalaureate',
//   'IGCSE / Cambridge International',
//   'A-Levels (British)',
//   'American Curriculum (US)',
//   'French Baccalauréat (Francophone)',
//   'Thanaweya Amma (Egypt)',
//   'National Curriculum (country-specific)',
//   'Technical/Vocational Pathways',
// ];

// const AFRICAN_LANGUAGES = [
//   'English','French','Arabic','Swahili','Hausa','Amharic','Yoruba','Igbo','Portuguese',
//   'Akan (Twi)','Oromo','Shona','Zulu','Xhosa','Wolof','Kinyarwanda','Kirundi','Sesotho',
//   'Tswana','Tigrinya','Somali','Berber (Tamazight)','Afrikaans','Lingala','Fula','Chichewa'
// ];

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [selectedRoleForProfile, setSelectedRoleForProfile] = useState('');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);
//   const [error, setError] = useState('');
//   const [resetEmailSent, setResetEmailSent] = useState(false);

//   const [studentData, setStudentData] = useState({
//     name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '', languageProficiency: ''
//   });
//   const [teacherData, setTeacherData] = useState({
//     name: '', country: '', educationalSystem: '', subjectArea: '', contactInfo: ''
//   });

//   // --- Auth listener ---
//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         try {
//           const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//           if (userDoc.exists()) {
//             const profileData = userDoc.data();
//             setUserRole(profileData.role || '');
//             setUserProfile(profileData);
//             if (profileData && Object.keys(profileData).length > 0) {
//               setStep(1);
//             }
//           } else {
//             setUserRole('');
//             setUserProfile(null);
//             setStep(2);
//           }
//         } catch (err) {
//           console.error('Error fetching user doc:', err);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//         setStep(1);
//       }
//       setInitializing(false);
//     });
//     return () => unsubscribe();
//   }, []);

//   // --- Auth actions ---
//   const handleAuth = async () => {
//     setError('');
//     if (!email || !password) {
//       setError('Please fill in both email and password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       if (isLogin) {
//         await signInWithEmailAndPassword(auth, email, password);
//       } else {
//         const credential = await createUserWithEmailAndPassword(auth, email, password);
//         await setDoc(doc(db, 'users', credential.user.uid), {
//           email: credential.user.email,
//           role: '',
//           createdAt: new Date().toISOString()
//         });
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') setError('Email already registered.');
//       else if (err.code === 'auth/wrong-password') setError('Wrong password.');
//       else if (err.code === 'auth/user-not-found') setError('No account found.');
//       else setError('Authentication failed.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotPassword = async () => {
//     if (!email) {
//       setError('Enter your email to reset password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       await sendPasswordResetEmail(auth, email);
//       setResetEmailSent(true);
//     } catch {
//       setError('Failed to send reset email.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   // --- FIX OPTION 1: persist role immediately ---
//   const handleRoleSelection = async (chosenRole) => {
//     setError('');
//     setLoading(true);
//     try {
//       const uid = auth.currentUser?.uid;
//       if (!uid) throw new Error('User not authenticated.');

//       await setDoc(doc(db, 'users', uid), { role: chosenRole }, { merge: true });

//       setSelectedRoleForProfile(chosenRole);
//       setStep(3);
//       setRole(chosenRole);
//     } catch (err) {
//       console.error('Failed to save role:', err);
//       setError('Failed to save role. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);
//     try {
//       const uid = user?.uid;
//       if (!uid) throw new Error('User not authenticated.');

//       let profilePayload = {};
//       if (selectedRoleForProfile === 'student') {
//         const values = Object.values(studentData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all student fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'student', ...studentData, createdAt: new Date().toISOString() };
//       } else {
//         const values = Object.values(teacherData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all teacher fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'teacher', ...teacherData, createdAt: new Date().toISOString() };
//       }

//       await setDoc(doc(db, 'users', uid), profilePayload, { merge: true });
//       setUserRole(profilePayload.role);
//       setUserProfile(profilePayload);
//       setStep(1);
//     } catch (err) {
//       console.error(err);
//       setError('Failed to save profile.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     await signOut(auth);
//     setUser(null);
//     setUserRole('');
//     setUserProfile(null);
//     setEmail('');
//     setPassword('');
//     setStep(1);
//   };

//   // --- Theming ---
//   const bg = "bg-[#f9fdf9]";
//   const card = "bg-white border border-green-100 shadow-lg";
//   const text = "text-[#1b1b1b]";
//   const accent = "bg-[#2e7d32] hover:bg-[#43a047] text-white";
//   const heading = "text-[#2e7d32]";
//   const inputBase = "w-full mb-4 px-3 py-2 rounded border border-green-200 focus:outline-none focus:ring-2 focus:ring-[#43a047] bg-white text-[#1b1b1b]";

//   // --- States ---
//   if (initializing) {
//     return (
//       <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//         <div className="text-center">
//           <div className="w-16 h-16 border-4 border-[#2e7d32] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <div className={`${text}`}>Loading...</div>
//         </div>
//       </div>
//     );
//   }

//   if (user && userProfile && userRole === 'student')
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   if (user && userProfile && userRole === 'teacher')
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;

//   // --- Step 1: Auth screen ---
//   if (!user && step === 1) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-3xl font-semibold text-center mb-6 ${heading}`}>
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {resetEmailSent && <div className="bg-green-50 text-green-700 px-3 py-2 rounded mb-4 text-sm">Password reset email sent!</div>}

//           <label>Email address</label>
//           <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputBase} placeholder="Enter email" />
//           <label>Password</label>
//           <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className={inputBase} placeholder="Enter password" />

//           {!isLogin && (
//             <>
//               <label>I am a</label>
//               <select value={role} onChange={e=>setRole(e.target.value)} className={inputBase}>
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </>
//           )}

//           <div className="flex justify-between mb-4 text-sm">
//             <button onClick={handleForgotPassword} className="text-[#2e7d32] hover:underline">Forgot password?</button>
//           </div>

//           <button onClick={handleAuth} disabled={loading} className={`w-full py-2 rounded ${accent}`}>
//             {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Continue'}
//           </button>

//           <p className="text-center mt-4">
//             {isLogin ? "Don't have an account?" : "Already have an account?"}
//             <button onClick={()=>{setIsLogin(!isLogin); setError(''); setResetEmailSent(false);}} className="text-[#2e7d32] ml-2 underline">
//               {isLogin ? 'Sign Up' : 'Sign In'}
//             </button>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   // --- Step 2: Role selection ---
//   if (user && step === 2) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>Select Your Role</h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           <div className="flex justify-around mb-6">
//             <button onClick={()=>handleRoleSelection('student')} className={`px-4 py-2 rounded w-32 ${accent}`}>Student</button>
//             <button onClick={()=>handleRoleSelection('teacher')} className={`px-4 py-2 rounded w-32 ${accent}`}>Teacher</button>
//           </div>
//           <button onClick={()=>setStep(1)} className="w-full py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition">Back</button>
//         </div>
//       </div>
//     );
//   }

//   // --- Step 3: Complete Profile ---
//   if (step === 3 && selectedRoleForProfile) {
//     const isStudent = selectedRoleForProfile === 'student';
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>
//             {isStudent ? 'Student Profile' : 'Teacher Profile'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {isStudent ? (
//             <>
//               <label>Full Name</label>
//               <input type="text" value={studentData.name} onChange={e=>setStudentData({...studentData, name:e.target.value})} className={inputBase} />
//               <label>Country</label>
//               <select value={studentData.country} onChange={e=>setStudentData({...studentData, country:e.target.value})} className={inputBase}>
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select value={studentData.educationalSystem} onChange={e=>setStudentData({...studentData, educationalSystem:e.target.value})} className={inputBase}>
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
//               </select>
//               <label>Language</label>
//               <select value={studentData.languageProficiency} onChange={e=>setStudentData({...studentData, languageProficiency:e.target.value})} className={inputBase}>
//                 <option value="">Select language</option>
//                 {AFRICAN_LANGUAGES.map(l=><option key={l}>{l}</option>)}
//               </select>
//               <label>Strengths</label>
//               <textarea value={studentData.strengths} onChange={e=>setStudentData({...studentData, strengths:e.target.value})} className={inputBase} rows={3}/>
//               <label>Areas for Improvement</label>
//               <textarea value={studentData.weaknesses} onChange={e=>setStudentData({...studentData, weaknesses:e.target.value})} className={inputBase} rows={3}/>
//             </>
//           ) : (
//             <>
//               <label>Full Name</label>
//               <input type="text" value={teacherData.name} onChange={e=>setTeacherData({...teacherData, name:e.target.value})} className={inputBase}/>
//               <label>Country</label>
//               <select value={teacherData.country} onChange={e=>setTeacherData({...teacherData, country:e.target.value})} className={inputBase}>
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select value={teacherData.educationalSystem} onChange={e=>setTeacherData({...teacherData, educationalSystem:e.target.value})} className={inputBase}>
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
//               </select>
//               <label>Subject Area</label>
//               <input type="text" value={teacherData.subjectArea} onChange={e=>setTeacherData({...teacherData, subjectArea:e.target.value})} className={inputBase}/>
//               <label>Contact Info</label>
//               <input type="text" value={teacherData.contactInfo} onChange={e=>setTeacherData({...teacherData, contactInfo:e.target.value})} className={inputBase}/>
//             </>
//           )}

//           <div className="flex space-x-3">
//             <button onClick={handleProfileSubmit} disabled={loading} className={`flex-1 py-2 rounded ${accent}`}>
//               {loading ? 'Saving...' : 'Save Profile'}
//             </button>
//             <button onClick={()=>{setSelectedRoleForProfile(''); setStep(2);}} className="flex-1 py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32]">
//               Back
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // --- Fallback ---
//   return (
//     <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//       <p className={`${text}`}>Unexpected state. Please reload.</p>
//     </div>
//   );
// }



















// import { useState, useEffect } from 'react';
// import {
//   createUserWithEmailAndPassword,
//   signInWithEmailAndPassword,
//   onAuthStateChanged,
//   signOut,
//   sendPasswordResetEmail
// } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';
// import './index.css';

// // --- Full lists ---
// const AFRICAN_COUNTRIES = [
//   'Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cameroon','Cape Verde',
//   'Central African Republic','Chad','Comoros','Republic of the Congo','Democratic Republic of the Congo',
//   'Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana',
//   'Guinea','Guinea-Bissau','Ivory Coast','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi',
//   'Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda',
//   'Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan',
//   'Sudan','Tanzania','Togo','Tunisia','Uganda','Zambia','Zimbabwe'
// ];

// const EDUCATIONAL_SYSTEMS = [
//   'CBC - Competency Based Curriculum (Kenya)',
//   '8-4-4 System (Kenya - legacy)',
//   '6-3-3-4 System (Nigeria)',
//   'Universal Basic Education (UBE)',
//   'CAPS - Curriculum and Assessment Policy Statements (South Africa)',
//   'WAEC / WASSCE (West Africa)',
//   'NECO (Nigeria)',
//   'Matric / NSC (South Africa)',
//   'IB - International Baccalaureate',
//   'IGCSE / Cambridge International',
//   'A-Levels (British)',
//   'American Curriculum (US)',
//   'French Baccalauréat (Francophone)',
//   'Thanaweya Amma (Egypt)',
//   'National Curriculum (country-specific)',
//   'Technical/Vocational Pathways',
// ];

// const AFRICAN_LANGUAGES = [
//   'English','French','Arabic','Swahili','Hausa','Amharic','Yoruba','Igbo','Portuguese',
//   'Akan (Twi)','Oromo','Shona','Zulu','Xhosa','Wolof','Kinyarwanda','Kirundi','Sesotho',
//   'Tswana','Tigrinya','Somali','Berber (Tamazight)','Afrikaans','Lingala','Fula','Chichewa'
// ];

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [selectedRoleForProfile, setSelectedRoleForProfile] = useState('');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);
//   const [error, setError] = useState('');
//   const [resetEmailSent, setResetEmailSent] = useState(false);

//   const [studentData, setStudentData] = useState({
//     name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '', languageProficiency: ''
//   });
//   const [teacherData, setTeacherData] = useState({
//     name: '', country: '', educationalSystem: '', subjectArea: '', contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         try {
//           const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//           if (userDoc.exists()) {
//             const profileData = userDoc.data();
//             setUserRole(profileData.role || '');
//             setUserProfile(profileData);
//             if (profileData && Object.keys(profileData).length > 0) {
//               setStep(1);
//             }
//           } else {
//             setUserRole('');
//             setUserProfile(null);
//             setStep(2);
//           }
//         } catch (err) {
//           console.error('Error fetching user doc:', err);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//         setStep(1);
//       }
//       setInitializing(false);
//     });
//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     setError('');
//     if (!email || !password) {
//       setError('Please fill in both email and password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       if (isLogin) {
//         await signInWithEmailAndPassword(auth, email, password);
//       } else {
//         const credential = await createUserWithEmailAndPassword(auth, email, password);
//         await setDoc(doc(db, 'users', credential.user.uid), {
//           email: credential.user.email,
//           role: '',
//           createdAt: new Date().toISOString()
//         });
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') setError('Email already registered.');
//       else if (err.code === 'auth/wrong-password') setError('Wrong password.');
//       else if (err.code === 'auth/user-not-found') setError('No account found.');
//       else setError('Authentication failed.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotPassword = async () => {
//     if (!email) {
//       setError('Enter your email to reset password.');
//       return;
//     }
//     setLoading(true);
//     try {
//       await sendPasswordResetEmail(auth, email);
//       setResetEmailSent(true);
//     } catch {
//       setError('Failed to send reset email.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleRoleSelection = (chosenRole) => {
//     setSelectedRoleForProfile(chosenRole);
//     setStep(3);
//     setRole(chosenRole);
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);
//     try {
//       const uid = user?.uid;
//       if (!uid) throw new Error('User not authenticated.');
//       let profilePayload = {};
//       if (selectedRoleForProfile === 'student') {
//         const values = Object.values(studentData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all student fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'student', ...studentData, createdAt: new Date().toISOString() };
//       } else {
//         const values = Object.values(teacherData);
//         if (values.some(v => !String(v || '').trim())) {
//           setError('Please fill all teacher fields.');
//           setLoading(false);
//           return;
//         }
//         profilePayload = { email, role: 'teacher', ...teacherData, createdAt: new Date().toISOString() };
//       }
//       await setDoc(doc(db, 'users', uid), profilePayload, { merge: true });
//       setUserRole(profilePayload.role);
//       setUserProfile(profilePayload);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     await signOut(auth);
//     setUser(null);
//     setUserRole('');
//     setUserProfile(null);
//     setEmail('');
//     setPassword('');
//     setStep(1);
//   };

//   // --- Theming replacements start here ---
//   const bg = "bg-[#f9fdf9]";
//   const card = "bg-white border border-green-100 shadow-lg";
//   const text = "text-[#1b1b1b]";
//   const accent = "bg-[#2e7d32] hover:bg-[#43a047] text-white";
//   const heading = "text-[#2e7d32]";
//   const inputBase = "w-full mb-4 px-3 py-2 rounded border border-green-200 focus:outline-none focus:ring-2 focus:ring-[#43a047] bg-white text-[#1b1b1b]";

//   if (initializing) {
//     return (
//       <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//         <div className="text-center">
//           <div className="w-16 h-16 border-4 border-[#2e7d32] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <div className={`${text}`}>Loading...</div>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   if (user && userRole === 'teacher' && userProfile) return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;

//   // --- Auth Screen ---
//   if (!user && step === 1) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-3xl font-semibold text-center mb-6 ${heading}`}>
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {resetEmailSent && <div className="bg-green-50 text-green-700 px-3 py-2 rounded mb-4 text-sm">Password reset email sent!</div>}

//           <label>Email address</label>
//           <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputBase} placeholder="Enter email" />
//           <label>Password</label>
//           <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className={inputBase} placeholder="Enter password" />

//           {!isLogin && (
//             <>
//               <label>I am a</label>
//               <select value={role} onChange={e=>setRole(e.target.value)} className={inputBase}>
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </>
//           )}

//           <div className="flex justify-between mb-4 text-sm">
//             <button onClick={handleForgotPassword} className="text-[#2e7d32] hover:underline">Forgot password?</button>
//           </div>

//           <button onClick={handleAuth} disabled={loading} className={`w-full py-2 rounded ${accent}`}>
//             {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Continue'}
//           </button>

//           <p className="text-center mt-4">
//             {isLogin ? "Don't have an account?" : "Already have an account?"}
//             <button onClick={()=>{setIsLogin(!isLogin); setError(''); setResetEmailSent(false);}} className="text-[#2e7d32] ml-2 underline">
//               {isLogin ? 'Sign Up' : 'Sign In'}
//             </button>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   // --- Role selection ---
//   if (!user && step === 2) {
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>Select Your Role</h2>
//           <div className="flex justify-around mb-6">
//             <button onClick={()=>handleRoleSelection('student')} className={`px-4 py-2 rounded w-32 ${accent}`}>Student</button>
//             <button onClick={()=>handleRoleSelection('teacher')} className={`px-4 py-2 rounded w-32 ${accent}`}>Teacher</button>
//           </div>
//           <button onClick={()=>setStep(1)} className="w-full py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32] transition">Back</button>
//         </div>
//       </div>
//     );
//   }

//   // --- Complete Profile Form ---
//   if (step === 3 && selectedRoleForProfile) {
//     const isStudent = selectedRoleForProfile === 'student';
//     return (
//       <div className={`flex justify-center items-center min-h-screen ${bg}`}>
//         <div className={`w-full max-w-md ${card} p-8 rounded-xl`}>
//           <h2 className={`text-2xl font-semibold text-center mb-4 ${heading}`}>
//             {isStudent ? 'Student Profile' : 'Teacher Profile'}
//           </h2>
//           {error && <div className="bg-red-100 text-red-700 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
//           {isStudent ? (
//             <>
//               <label>Full Name</label>
//               <input type="text" value={studentData.name} onChange={e=>setStudentData({...studentData, name:e.target.value})} className={inputBase} />
//               <label>Country</label>
//               <select value={studentData.country} onChange={e=>setStudentData({...studentData, country:e.target.value})} className={inputBase}>
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select value={studentData.educationalSystem} onChange={e=>setStudentData({...studentData, educationalSystem:e.target.value})} className={inputBase}>
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
//               </select>
//               <label>Language</label>
//               <select value={studentData.languageProficiency} onChange={e=>setStudentData({...studentData, languageProficiency:e.target.value})} className={inputBase}>
//                 <option value="">Select language</option>
//                 {AFRICAN_LANGUAGES.map(l=><option key={l}>{l}</option>)}
//               </select>
//               <label>Strengths</label>
//               <textarea value={studentData.strengths} onChange={e=>setStudentData({...studentData, strengths:e.target.value})} className={inputBase} rows={3}/>
//               <label>Areas for Improvement</label>
//               <textarea value={studentData.weaknesses} onChange={e=>setStudentData({...studentData, weaknesses:e.target.value})} className={inputBase} rows={3}/>
//             </>
//           ) : (
//             <>
//               <label>Full Name</label>
//               <input type="text" value={teacherData.name} onChange={e=>setTeacherData({...teacherData, name:e.target.value})} className={inputBase}/>
//               <label>Country</label>
//               <select value={teacherData.country} onChange={e=>setTeacherData({...teacherData, country:e.target.value})} className={inputBase}>
//                 <option value="">Select country</option>
//                 {AFRICAN_COUNTRIES.map(c=><option key={c}>{c}</option>)}
//               </select>
//               <label>Educational System</label>
//               <select value={teacherData.educationalSystem} onChange={e=>setTeacherData({...teacherData, educationalSystem:e.target.value})} className={inputBase}>
//                 <option value="">Select system</option>
//                 {EDUCATIONAL_SYSTEMS.map(s=><option key={s}>{s}</option>)}
//               </select>
//               <label>Subject Area</label>
//               <input type="text" value={teacherData.subjectArea} onChange={e=>setTeacherData({...teacherData, subjectArea:e.target.value})} className={inputBase}/>
//               <label>Contact Info</label>
//               <input type="text" value={teacherData.contactInfo} onChange={e=>setTeacherData({...teacherData, contactInfo:e.target.value})} className={inputBase}/>
//             </>
//           )}

//           <div className="flex space-x-3">
//             <button onClick={handleProfileSubmit} disabled={loading} className={`flex-1 py-2 rounded ${accent}`}>
//               {loading ? 'Saving...' : 'Save Profile'}
//             </button>
//             <button onClick={()=>{setSelectedRoleForProfile(''); setStep(2);}} className="flex-1 py-2 rounded border border-green-300 hover:bg-green-50 text-[#2e7d32]">
//               Back
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className={`min-h-screen flex items-center justify-center ${bg}`}>
//       <p className={`${text}`}>Unexpected state. Please reload.</p>
//     </div>
//   );
// }



















// import { useState, useEffect } from 'react';
// import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';


// // African countries list
// const AFRICAN_COUNTRIES = [
//   'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon', 'Cape Verde',
//   'Central African Republic', 'Chad', 'Comoros', 'Congo', 'Democratic Republic of the Congo',
//   'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia',
//   'Ghana', 'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia', 'Libya',
//   'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Mozambique', 'Namibia',
//   'Niger', 'Nigeria', 'Rwanda', 'Sao Tome and Principe', 'Senegal', 'Seychelles', 'Sierra Leone',
//   'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda',
//   'Zambia', 'Zimbabwe'
// ];

// // African education systems
// const EDUCATIONAL_SYSTEMS = [
//   '8-4-4 System (Kenya)',
//   'CBC - Competency Based Curriculum (Kenya)',
//   'IGCSE - International General Certificate of Secondary Education',
//   'IB - International Baccalaureate',
//   'A-Levels - Advanced Level',
//   'WAEC - West African Examinations Council',
//   'NECO - National Examinations Council (Nigeria)',
//   'Matric - National Senior Certificate (South Africa)',
//   'WASSCE - West African Senior School Certificate Examination',
//   'Baccalauréat (North African French System)',
//   'Thanaweya Amma (Egypt)',
//   'UCE - Uganda Certificate of Education',
//   'UNEB - Uganda National Examinations Board',
//   'ZIMSEC - Zimbabwe School Examinations Council',
//   'Cambridge International',
//   'American Curriculum',
//   'British Curriculum',
//   'French Baccalauréat',
//   'National Curriculum'
// ];

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);
//   const [resetEmailSent, setResetEmailSent] = useState(false);

//   const [studentData, setStudentData] = useState({
//     name: '',
//     country: '',
//     educationalSystem: '',
//     strengths: '',
//     weaknesses: ''
//   });

//   const [teacherData, setTeacherData] = useState({
//     name: '',
//     country: '',
//     educationalSystem: '',
//     languageProficiencies: '',
//     subjectArea: '',
//     contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//       }
//       setInitializing(false);
//     });

//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     if (!email || !password) {
//       setError('Please fill in all fields');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       if (isLogin) {
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//           setUser(userCredential.user);
//         } else {
//           setError('User data not found');
//         }
//       } else {
//         const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//         setUser(userCredential.user);
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') {
//         setError('This email is already registered. Please sign in.');
//       } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
//         setError('Incorrect password. Please try again.');
//       } else if (err.code === 'auth/user-not-found') {
//         setError('Incorrect email. No account found with this email.');
//       } else if (err.code === 'auth/weak-password') {
//         setError('Password should be at least 6 characters.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Invalid email address. Please enter a valid email.');
//       } else {
//         setError('Authentication failed. Please check your credentials.');
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotPassword = async () => {
//     if (!email) {
//       setError('Please enter your email address to reset password');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       await sendPasswordResetEmail(auth, email);
//       setResetEmailSent(true);
//       setError('');
//     } catch (err) {
//       if (err.code === 'auth/user-not-found') {
//         setError('Incorrect email. No account found with this email.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Invalid email address. Please enter a valid email.');
//       } else {
//         setError('Failed to send reset email. Please try again.');
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);

//     try {
//       const profileData = role === 'student' ? studentData : teacherData;
//       const hasEmptyFields = Object.values(profileData).some(val => !val.trim());
//       if (hasEmptyFields) {
//         setError('Please fill in all fields');
//         setLoading(false);
//         return;
//       }

//       const completeProfile = {
//         email: email,
//         role: role,
//         ...profileData,
//         createdAt: new Date().toISOString()
//       };

//       await setDoc(doc(db, 'users', user.uid), completeProfile);
      
//       setUserRole(role);
//       setUserProfile(completeProfile);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     try {
//       await signOut(auth);
//       setUser(null);
//       setUserRole('');
//       setUserProfile(null);
//       setEmail('');
//       setPassword('');
//       setStudentData({ name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '' });
//       setTeacherData({ country: '', educationalSystem: '', languageProficiencies: '', subjectArea: '', contactInfo: '' });
//       setStep(1);
//     } catch (err) {
//       setError(err.message);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       if (step === 1) {
//         handleAuth();
//       } else {
//         handleProfileSubmit();
//       }
//     }
//   };

//   if (initializing) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
//         <div className="text-white text-center">
//           <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <p className="text-xl font-semibold">Loading...</p>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) {
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (user && userRole === 'teacher' && userProfile) {
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (step === 2 && user) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//         <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-lg">
//           <div className="mb-8 text-center">
//             <h1 className="text-3xl font-bold text-gray-800 mb-2">Complete Your Profile</h1>
//             <p className="text-gray-600">
//               {role === 'student' ? 'Student Information' : 'Teacher Information'}
//             </p>
//             <div className="mt-4 inline-block bg-green-100 px-6 py-2 rounded-full">
//               <span className="text-green-700 font-semibold capitalize">{role}</span>
//             </div>
//           </div>

//           {error && (
//             <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//               {error}
//             </div>
//           )}

//           {role === 'student' ? (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Full Name
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.name}
//                   onChange={(e) => setStudentData({...studentData, name: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter your full name"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <select
//                   value={studentData.country}
//                   onChange={(e) => setStudentData({...studentData, country: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select country</option>
//                   {AFRICAN_COUNTRIES.map(country => (
//                     <option key={country} value={country}>{country}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <select
//                   value={studentData.educationalSystem}
//                   onChange={(e) => setStudentData({...studentData, educationalSystem: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select educational system</option>
//                   {EDUCATIONAL_SYSTEMS.map(system => (
//                     <option key={system} value={system}>{system}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Your Strengths
//                 </label>
//                 <textarea
//                   value={studentData.strengths}
//                   onChange={(e) => setStudentData({...studentData, strengths: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter your strengths"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Areas for Improvement
//                 </label>
//                 <textarea
//                   value={studentData.weaknesses}
//                   onChange={(e) => setStudentData({...studentData, weaknesses: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter areas for improvement"
//                 />
//               </div>
//             </div>
//           ) : (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <select
//                   value={teacherData.country}
//                   onChange={(e) => setTeacherData({...teacherData, country: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select country</option>
//                   {AFRICAN_COUNTRIES.map(country => (
//                     <option key={country} value={country}>{country}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <select
//                   value={teacherData.educationalSystem}
//                   onChange={(e) => setTeacherData({...teacherData, educationalSystem: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select educational system</option>
//                   {EDUCATIONAL_SYSTEMS.map(system => (
//                     <option key={system} value={system}>{system}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Language Proficiencies
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.languageProficiencies}
//                   onChange={(e) => setTeacherData({...teacherData, languageProficiencies: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter languages"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Subject Area
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.subjectArea}
//                   onChange={(e) => setTeacherData({...teacherData, subjectArea: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter subject"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Contact Information
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.contactInfo}
//                   onChange={(e) => setTeacherData({...teacherData, contactInfo: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter contact info"
//                 />
//               </div>
//             </div>
//           )}

//           <button
//             onClick={handleProfileSubmit}
//             disabled={loading}
//             className="w-full mt-6 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Saving...' : 'Submit'}
//           </button>

//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <button onClick={handleForgotPassword} className="text-green-600 hover:underline">password?</button>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//       <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md">
//         <div className="text-center mb-8">
//           <h1 className="text-3xl font-bold text-gray-800 mb-2">
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h1>
//           <p className="text-gray-600">
//             {isLogin ? 'Welcome back! Please sign in to continue.' : 'Create your account to get started.'}
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//             {error}
//           </div>
//         )}

//         {resetEmailSent && (
//           <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//             Password reset email sent! Check your inbox.
//           </div>
//         )}

//         <div className="space-y-5">
//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Email address
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter email"
//             />
//           </div>

//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Password
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter password"
//             />
//             {!isLogin && (
//               <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters</p>
//             )}
//           </div>

//           {!isLogin && (
//             <div>
//               <label className="block text-sm font-semibold text-gray-700 mb-2">
//                 I am a
//               </label>
//               <select
//                 value={role}
//                 onChange={(e) => setRole(e.target.value)}
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//               >
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </div>
//           )}

//           {isLogin && (
//             <div className="flex items-center">
//               <input
//                 type="checkbox"
//                 id="remember"
//                 className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
//               />
//               <label htmlFor="remember" className="ml-2 text-sm text-gray-700">
//                 Remember me
//               </label>
//             </div>
//           )}

//           <button
//             onClick={handleAuth}
//             disabled={loading}
//             className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Processing...' : isLogin ? 'Submit' : 'Continue'}
//           </button>
//         </div>

//         <p className="text-center text-sm text-gray-600 mt-6">
//           {isLogin ? (
//             <>
//               Don't have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(false);
//                   setError('');
//                   setResetEmailSent(false);
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign Up
//               </button>
//             </>
//           ) : (
//             <>
//               Already have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(true);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign In
//               </button>
//             </>
//           )}
//         </p>

//         {isLogin && (
//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <button onClick={handleForgotPassword} className="text-green-600 hover:underline">password?</button>
//           </p>
//         )}
//       </div>
//     </div>
//   );
// }

























// import { useState, useEffect } from 'react';
// import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';

// // African countries list
// const AFRICAN_COUNTRIES = [
//   'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon', 'Cape Verde',
//   'Central African Republic', 'Chad', 'Comoros', 'Congo', 'Democratic Republic of the Congo',
//   'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea', 'Eswatini', 'Ethiopia', 'Gabon', 'Gambia',
//   'Ghana', 'Guinea', 'Guinea-Bissau', 'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia', 'Libya',
//   'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Mozambique', 'Namibia',
//   'Niger', 'Nigeria', 'Rwanda', 'Sao Tome and Principe', 'Senegal', 'Seychelles', 'Sierra Leone',
//   'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda',
//   'Zambia', 'Zimbabwe'
// ];

// // African education systems
// const EDUCATIONAL_SYSTEMS = [
//   '8-4-4 System (Kenya)',
//   'CBC - Competency Based Curriculum (Kenya)',
//   'IGCSE - International General Certificate of Secondary Education',
//   'IB - International Baccalaureate',
//   'A-Levels - Advanced Level',
//   'WAEC - West African Examinations Council',
//   'NECO - National Examinations Council (Nigeria)',
//   'Matric - National Senior Certificate (South Africa)',
//   'WASSCE - West African Senior School Certificate Examination',
//   'Baccalauréat (North African French System)',
//   'Thanaweya Amma (Egypt)',
//   'UCE - Uganda Certificate of Education',
//   'UNEB - Uganda National Examinations Board',
//   'ZIMSEC - Zimbabwe School Examinations Council',
//   'Cambridge International',
//   'American Curriculum',
//   'British Curriculum',
//   'French Baccalauréat',
//   'National Curriculum'
// ];

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);
//   const [resetEmailSent, setResetEmailSent] = useState(false);

//   const [studentData, setStudentData] = useState({
//     name: '',
//     country: '',
//     educationalSystem: '',
//     strengths: '',
//     weaknesses: ''
//   });

//   const [teacherData, setTeacherData] = useState({
//     country: '',
//     educationalSystem: '',
//     languageProficiencies: '',
//     subjectArea: '',
//     contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//       }
//       setInitializing(false);
//     });

//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     if (!email || !password) {
//       setError('Please fill in all fields');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       if (isLogin) {
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//           setUser(userCredential.user);
//         } else {
//           setError('User data not found');
//         }
//       } else {
//         const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//         setUser(userCredential.user);
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') {
//         setError('This email is already registered. Please sign in.');
//       } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
//         setError('Incorrect password. Please try again.');
//       } else if (err.code === 'auth/user-not-found') {
//         setError('Incorrect email. No account found with this email.');
//       } else if (err.code === 'auth/weak-password') {
//         setError('Password should be at least 6 characters.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Invalid email address. Please enter a valid email.');
//       } else {
//         setError('Authentication failed. Please check your credentials.');
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleForgotPassword = async () => {
//     if (!email) {
//       setError('Please enter your email address to reset password');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       await sendPasswordResetEmail(auth, email);
//       setResetEmailSent(true);
//       setError('');
//     } catch (err) {
//       if (err.code === 'auth/user-not-found') {
//         setError('Incorrect email. No account found with this email.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Invalid email address. Please enter a valid email.');
//       } else {
//         setError('Failed to send reset email. Please try again.');
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);

//     try {
//       const profileData = role === 'student' ? studentData : teacherData;
//       const hasEmptyFields = Object.values(profileData).some(val => !val.trim());
//       if (hasEmptyFields) {
//         setError('Please fill in all fields');
//         setLoading(false);
//         return;
//       }

//       const completeProfile = {
//         email: email,
//         role: role,
//         ...profileData,
//         createdAt: new Date().toISOString()
//       };

//       await setDoc(doc(db, 'users', user.uid), completeProfile);
      
//       setUserRole(role);
//       setUserProfile(completeProfile);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     try {
//       await signOut(auth);
//       setUser(null);
//       setUserRole('');
//       setUserProfile(null);
//       setEmail('');
//       setPassword('');
//       setStudentData({ name: '', country: '', educationalSystem: '', strengths: '', weaknesses: '' });
//       setTeacherData({ country: '', educationalSystem: '', languageProficiencies: '', subjectArea: '', contactInfo: '' });
//       setStep(1);
//     } catch (err) {
//       setError(err.message);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       if (step === 1) {
//         handleAuth();
//       } else {
//         handleProfileSubmit();
//       }
//     }
//   };

//   if (initializing) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
//         <div className="text-white text-center">
//           <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <p className="text-xl font-semibold">Loading...</p>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) {
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (user && userRole === 'teacher' && userProfile) {
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (step === 2 && user) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//         <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-lg">
//           <div className="mb-8 text-center">
//             <h1 className="text-3xl font-bold text-gray-800 mb-2">Complete Your Profile</h1>
//             <p className="text-gray-600">
//               {role === 'student' ? 'Student Information' : 'Teacher Information'}
//             </p>
//             <div className="mt-4 inline-block bg-green-100 px-6 py-2 rounded-full">
//               <span className="text-green-700 font-semibold capitalize">{role}</span>
//             </div>
//           </div>

//           {error && (
//             <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//               {error}
//             </div>
//           )}

//           {role === 'student' ? (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Full Name
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.name}
//                   onChange={(e) => setStudentData({...studentData, name: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter your full name"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <select
//                   value={studentData.country}
//                   onChange={(e) => setStudentData({...studentData, country: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select country</option>
//                   {AFRICAN_COUNTRIES.map(country => (
//                     <option key={country} value={country}>{country}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <select
//                   value={studentData.educationalSystem}
//                   onChange={(e) => setStudentData({...studentData, educationalSystem: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select educational system</option>
//                   {EDUCATIONAL_SYSTEMS.map(system => (
//                     <option key={system} value={system}>{system}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Your Strengths
//                 </label>
//                 <textarea
//                   value={studentData.strengths}
//                   onChange={(e) => setStudentData({...studentData, strengths: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter your strengths"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Areas for Improvement
//                 </label>
//                 <textarea
//                   value={studentData.weaknesses}
//                   onChange={(e) => setStudentData({...studentData, weaknesses: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter areas for improvement"
//                 />
//               </div>
//             </div>
//           ) : (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <select
//                   value={teacherData.country}
//                   onChange={(e) => setTeacherData({...teacherData, country: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select country</option>
//                   {AFRICAN_COUNTRIES.map(country => (
//                     <option key={country} value={country}>{country}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <select
//                   value={teacherData.educationalSystem}
//                   onChange={(e) => setTeacherData({...teacherData, educationalSystem: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//                 >
//                   <option value="">Select educational system</option>
//                   {EDUCATIONAL_SYSTEMS.map(system => (
//                     <option key={system} value={system}>{system}</option>
//                   ))}
//                 </select>
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Language Proficiencies
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.languageProficiencies}
//                   onChange={(e) => setTeacherData({...teacherData, languageProficiencies: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter languages"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Subject Area
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.subjectArea}
//                   onChange={(e) => setTeacherData({...teacherData, subjectArea: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter subject"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Contact Information
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.contactInfo}
//                   onChange={(e) => setTeacherData({...teacherData, contactInfo: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter contact info"
//                 />
//               </div>
//             </div>
//           )}

//           <button
//             onClick={handleProfileSubmit}
//             disabled={loading}
//             className="w-full mt-6 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Saving...' : 'Submit'}
//           </button>

//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <button onClick={handleForgotPassword} className="text-green-600 hover:underline">password?</button>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//       <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md">
//         <div className="text-center mb-8">
//           <h1 className="text-3xl font-bold text-gray-800 mb-2">
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h1>
//           <p className="text-gray-600">
//             {isLogin ? 'Welcome back! Please sign in to continue.' : 'Create your account to get started.'}
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//             {error}
//           </div>
//         )}

//         {resetEmailSent && (
//           <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//             Password reset email sent! Check your inbox.
//           </div>
//         )}

//         <div className="space-y-5">
//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Email address
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter email"
//             />
//           </div>

//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Password
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter password"
//             />
//             {!isLogin && (
//               <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters</p>
//             )}
//           </div>

//           {!isLogin && (
//             <div>
//               <label className="block text-sm font-semibold text-gray-700 mb-2">
//                 I am a
//               </label>
//               <select
//                 value={role}
//                 onChange={(e) => setRole(e.target.value)}
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//               >
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </div>
//           )}

//           {isLogin && (
//             <div className="flex items-center">
//               <input
//                 type="checkbox"
//                 id="remember"
//                 className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
//               />
//               <label htmlFor="remember" className="ml-2 text-sm text-gray-700">
//                 Remember me
//               </label>
//             </div>
//           )}

//           <button
//             onClick={handleAuth}
//             disabled={loading}
//             className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Processing...' : isLogin ? 'Submit' : 'Continue'}
//           </button>
//         </div>

//         <p className="text-center text-sm text-gray-600 mt-6">
//           {isLogin ? (
//             <>
//               Don't have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(false);
//                   setError('');
//                   setResetEmailSent(false);
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign Up
//               </button>
//             </>
//           ) : (
//             <>
//               Already have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(true);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign In
//               </button>
//             </>
//           )}
//         </p>

//         {isLogin && (
//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <button onClick={handleForgotPassword} className="text-green-600 hover:underline">password?</button>
//           </p>
//         )}
//       </div>
//     </div>
//   );
// }





// import { useState, useEffect } from 'react';
// import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);

//   const [studentData, setStudentData] = useState({
//     country: '',
//     educationalSystem: '',
//     strengths: '',
//     weaknesses: ''
//   });

//   const [teacherData, setTeacherData] = useState({
//     country: '',
//     educationalSystem: '',
//     languageProficiencies: '',
//     subjectArea: '',
//     contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//       }
//       setInitializing(false);
//     });

//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     if (!email || !password) {
//       setError('Please fill in all fields');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       if (isLogin) {
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//           setUser(userCredential.user);
//         } else {
//           setError('User data not found');
//         }
//       } else {
//         const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//         setUser(userCredential.user);
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') {
//         setError('This email is already registered. Please sign in.');
//       } else if (err.code === 'auth/wrong-password') {
//         setError('Incorrect password. Please try again.');
//       } else if (err.code === 'auth/user-not-found') {
//         setError('No account found with this email.');
//       } else if (err.code === 'auth/weak-password') {
//         setError('Password should be at least 6 characters.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Please enter a valid email address.');
//       } else {
//         setError(err.message);
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);

//     try {
//       const profileData = role === 'student' ? studentData : teacherData;
//       const hasEmptyFields = Object.values(profileData).some(val => !val.trim());
//       if (hasEmptyFields) {
//         setError('Please fill in all fields');
//         setLoading(false);
//         return;
//       }

//       const completeProfile = {
//         email: email,
//         role: role,
//         ...profileData,
//         createdAt: new Date().toISOString()
//       };

//       await setDoc(doc(db, 'users', user.uid), completeProfile);
      
//       setUserRole(role);
//       setUserProfile(completeProfile);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     try {
//       await signOut(auth);
//       setUser(null);
//       setUserRole('');
//       setUserProfile(null);
//       setEmail('');
//       setPassword('');
//       setStudentData({ country: '', educationalSystem: '', strengths: '', weaknesses: '' });
//       setTeacherData({ country: '', educationalSystem: '', languageProficiencies: '', subjectArea: '', contactInfo: '' });
//       setStep(1);
//     } catch (err) {
//       setError(err.message);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       if (step === 1) {
//         handleAuth();
//       } else {
//         handleProfileSubmit();
//       }
//     }
//   };

//   if (initializing) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
//         <div className="text-white text-center">
//           <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <p className="text-xl font-semibold">Loading...</p>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) {
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (user && userRole === 'teacher' && userProfile) {
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (step === 2 && user) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//         <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-lg">
//           <div className="mb-8 text-center">
//             <h1 className="text-3xl font-bold text-gray-800 mb-2">Complete Your Profile</h1>
//             <p className="text-gray-600">
//               {role === 'student' ? 'Student Information' : 'Teacher Information'}
//             </p>
//             <div className="mt-4 inline-block bg-green-100 px-6 py-2 rounded-full">
//               <span className="text-green-700 font-semibold capitalize">{role}</span>
//             </div>
//           </div>

//           {error && (
//             <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//               {error}
//             </div>
//           )}

//           {role === 'student' ? (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.country}
//                   onChange={(e) => setStudentData({...studentData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.educationalSystem}
//                   onChange={(e) => setStudentData({...studentData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Your Strengths
//                 </label>
//                 <textarea
//                   value={studentData.strengths}
//                   onChange={(e) => setStudentData({...studentData, strengths: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter your strengths"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Areas for Improvement
//                 </label>
//                 <textarea
//                   value={studentData.weaknesses}
//                   onChange={(e) => setStudentData({...studentData, weaknesses: e.target.value})}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
//                   rows="3"
//                   placeholder="Enter areas for improvement"
//                 />
//               </div>
//             </div>
//           ) : (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.country}
//                   onChange={(e) => setTeacherData({...teacherData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.educationalSystem}
//                   onChange={(e) => setTeacherData({...teacherData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Language Proficiencies
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.languageProficiencies}
//                   onChange={(e) => setTeacherData({...teacherData, languageProficiencies: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter languages"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Subject Area
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.subjectArea}
//                   onChange={(e) => setTeacherData({...teacherData, subjectArea: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter subject"
//                 />
//               </div>

//               <div>
//                 <label className="block text-sm font-semibold text-gray-700 mb-2">
//                   Contact Information
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.contactInfo}
//                   onChange={(e) => setTeacherData({...teacherData, contactInfo: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//                   placeholder="Enter contact info"
//                 />
//               </div>
//             </div>
//           )}

//           <button
//             onClick={handleProfileSubmit}
//             disabled={loading}
//             className="w-full mt-6 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Saving...' : 'Submit'}
//           </button>

//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <a href="#" className="text-green-600 hover:underline">password?</a>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center p-4">
//       <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md">
//         <div className="text-center mb-8">
//           <h1 className="text-3xl font-bold text-gray-800 mb-2">
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h1>
//           <p className="text-gray-600">
//             {isLogin ? 'Welcome back! Please sign in to continue.' : 'Create your account to get started.'}
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm text-center">
//             {error}
//           </div>
//         )}

//         <div className="space-y-5">
//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Email address
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter email"
//             />
//           </div>

//           <div>
//             <label className="block text-sm font-semibold text-gray-700 mb-2">
//               Password
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
//               placeholder="Enter password"
//             />
//             {!isLogin && (
//               <p className="text-xs text-gray-500 mt-1">Must be at least 6 characters</p>
//             )}
//           </div>

//           {!isLogin && (
//             <div>
//               <label className="block text-sm font-semibold text-gray-700 mb-2">
//                 I am a
//               </label>
//               <select
//                 value={role}
//                 onChange={(e) => setRole(e.target.value)}
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white cursor-pointer"
//               >
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </div>
//           )}

//           {isLogin && (
//             <div className="flex items-center">
//               <input
//                 type="checkbox"
//                 id="remember"
//                 className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
//               />
//               <label htmlFor="remember" className="ml-2 text-sm text-gray-700">
//                 Remember me
//               </label>
//             </div>
//           )}

//           <button
//             onClick={handleAuth}
//             disabled={loading}
//             className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Processing...' : isLogin ? 'Submit' : 'Continue'}
//           </button>
//         </div>

//         <p className="text-center text-sm text-gray-600 mt-6">
//           {isLogin ? (
//             <>
//               Don't have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(false);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign Up
//               </button>
//             </>
//           ) : (
//             <>
//               Already have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(true);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign In
//               </button>
//             </>
//           )}
//         </p>

//         {isLogin && (
//           <p className="text-center text-sm text-gray-600 mt-4">
//             Forgot <a href="#" className="text-green-600 hover:underline">password?</a>
//           </p>
//         )}
//       </div>
//     </div>
//   );
// }





























// import { useState, useEffect } from 'react';
// import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);

//   const [studentData, setStudentData] = useState({
//     country: '',
//     educationalSystem: '',
//     strengths: '',
//     weaknesses: ''
//   });

//   const [teacherData, setTeacherData] = useState({
//     country: '',
//     educationalSystem: '',
//     languageProficiencies: '',
//     subjectArea: '',
//     contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//       }
//       setInitializing(false);
//     });

//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     if (!email || !password) {
//       setError('Please fill in all fields');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       if (isLogin) {
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//           setUser(userCredential.user);
//         } else {
//           setError('User data not found');
//         }
//       } else {
//         const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//         setUser(userCredential.user);
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') {
//         setError('This email is already registered. Please sign in.');
//       } else if (err.code === 'auth/wrong-password') {
//         setError('Incorrect password. Please try again.');
//       } else if (err.code === 'auth/user-not-found') {
//         setError('No account found with this email.');
//       } else if (err.code === 'auth/weak-password') {
//         setError('Password should be at least 6 characters.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Please enter a valid email address.');
//       } else {
//         setError(err.message);
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);

//     try {
//       const profileData = role === 'student' ? studentData : teacherData;
//       const hasEmptyFields = Object.values(profileData).some(val => !val.trim());
//       if (hasEmptyFields) {
//         setError('Please fill in all fields');
//         setLoading(false);
//         return;
//       }

//       const completeProfile = {
//         email: email,
//         role: role,
//         ...profileData,
//         createdAt: new Date().toISOString()
//       };

//       await setDoc(doc(db, 'users', user.uid), completeProfile);
      
//       setUserRole(role);
//       setUserProfile(completeProfile);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     try {
//       await signOut(auth);
//       setUser(null);
//       setUserRole('');
//       setUserProfile(null);
//       setEmail('');
//       setPassword('');
//       setStudentData({ country: '', educationalSystem: '', strengths: '', weaknesses: '' });
//       setTeacherData({ country: '', educationalSystem: '', languageProficiencies: '', subjectArea: '', contactInfo: '' });
//       setStep(1);
//     } catch (err) {
//       setError(err.message);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       if (step === 1) {
//         handleAuth();
//       } else {
//         handleProfileSubmit();
//       }
//     }
//   };

//   if (initializing) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 flex items-center justify-center">
//         <div className="text-white text-center">
//           <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <p className="text-xl font-semibold">Loading...</p>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) {
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (user && userRole === 'teacher' && userProfile) {
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (step === 2 && user) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 flex items-center justify-center p-4">
//         <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-12">
//           <div className="mb-8">
//             <h1 className="text-3xl font-bold text-gray-800 mb-2">Complete Your Profile</h1>
//             <p className="text-gray-600">
//               {role === 'student' ? 'Student Information' : 'Teacher Information'}
//             </p>
//           </div>

//           {error && (
//             <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 mb-6">
//               {error}
//             </div>
//           )}

//           {role === 'student' ? (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.country}
//                   onChange={(e) => setStudentData({...studentData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.educationalSystem}
//                   onChange={(e) => setStudentData({...studentData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Your Strengths
//                 </label>
//                 <textarea
//                   value={studentData.strengths}
//                   onChange={(e) => setStudentData({...studentData, strengths: e.target.value})}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none text-gray-800"
//                   rows="3"
//                   placeholder="Enter your strengths"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Areas for Improvement
//                 </label>
//                 <textarea
//                   value={studentData.weaknesses}
//                   onChange={(e) => setStudentData({...studentData, weaknesses: e.target.value})}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none text-gray-800"
//                   rows="3"
//                   placeholder="Enter areas for improvement"
//                 />
//               </div>
//             </div>
//           ) : (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.country}
//                   onChange={(e) => setTeacherData({...teacherData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.educationalSystem}
//                   onChange={(e) => setTeacherData({...teacherData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Language Proficiencies
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.languageProficiencies}
//                   onChange={(e) => setTeacherData({...teacherData, languageProficiencies: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter languages"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Subject Area
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.subjectArea}
//                   onChange={(e) => setTeacherData({...teacherData, subjectArea: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter subject"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Contact Information
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.contactInfo}
//                   onChange={(e) => setTeacherData({...teacherData, contactInfo: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter contact info"
//                 />
//               </div>
//             </div>
//           )}

//           <button
//             onClick={handleProfileSubmit}
//             disabled={loading}
//             className="w-full mt-8 bg-green-600 hover:bg-green-700 text-white py-4 rounded-lg font-bold text-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Saving...' : 'Submit'}
//           </button>

//           <p className="text-center text-gray-600 mt-6">
//             Forgot <a href="#" className="text-green-600 hover:underline font-semibold">password?</a>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div style={{
//       minHeight: '100vh',
//       background: 'linear-gradient(to bottom right, #34d399, #10b981, #14b8a6)',
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       padding: '1rem'
//     }}>
//       <div style={{
//         background: 'white',
//         borderRadius: '1.5rem',
//         boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
//         width: '100%',
//         maxWidth: '32rem',
//         padding: '3rem'
//       }}>
//         <div className="mb-8">
//           <h1 className="text-4xl font-bold text-gray-800 mb-3">
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h1>
//           <p className="text-gray-600 text-base">
//             {isLogin ? 'Welcome back! Please sign in to continue.' : 'Create your account to get started.'}
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 mb-6">
//             {error}
//           </div>
//         )}

//         <form onSubmit={(e) => { e.preventDefault(); handleAuth(); }} className="space-y-5">
//           <div>
//             <label className="block text-gray-800 font-semibold mb-2">
//               Email address
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//               placeholder="Enter email"
//             />
//           </div>

//           <div>
//             <label className="block text-gray-800 font-semibold mb-2">
//               Password
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//               placeholder="Enter password"
//             />
//             {!isLogin && (
//               <p className="text-xs text-gray-500 mt-2">Must be at least 6 characters</p>
//             )}
//           </div>

//           {!isLogin && (
//             <div>
//               <label className="block text-gray-800 font-semibold mb-2">
//                 I am a
//               </label>
//               <select
//                 value={role}
//                 onChange={(e) => setRole(e.target.value)}
//                 className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer text-gray-800"
//               >
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </div>
//           )}

//           {isLogin && (
//             <div className="flex items-center">
//               <input
//                 type="checkbox"
//                 id="remember"
//                 className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
//               />
//               <label htmlFor="remember" className="ml-2 text-gray-700">
//                 Remember me
//               </label>
//             </div>
//           )}

//           <button
//             type="submit"
//             disabled={loading}
//             className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-lg font-bold text-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Processing...' : 'Submit'}
//           </button>
//         </form>

//         <p className="text-center text-gray-600 mt-6">
//           {isLogin ? (
//             <>
//               Don't have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(false);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign Up
//               </button>
//             </>
//           ) : (
//             <>
//               Already have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(true);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign In
//               </button>
//             </>
//           )}
//         </p>

//         {isLogin && (
//           <p className="text-center text-gray-600 mt-4">
//             Forgot <a href="#" className="text-green-600 hover:underline font-semibold">password?</a>
//           </p>
//         )}
//       </div>
//     </div>
//   );
// }







// import { useState, useEffect } from 'react';
// import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
// import { doc, setDoc, getDoc } from 'firebase/firestore';
// import { auth, db } from './firebase';
// import StudentDashboard from './components/StudentDashboard';
// import TeacherDashboard from './components/TeacherDashboard';

// export default function AuthApp() {
//   const [isLogin, setIsLogin] = useState(true);
//   const [step, setStep] = useState(1);
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [role, setRole] = useState('student');
//   const [user, setUser] = useState(null);
//   const [userRole, setUserRole] = useState('');
//   const [userProfile, setUserProfile] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [initializing, setInitializing] = useState(true);

//   const [studentData, setStudentData] = useState({
//     country: '',
//     educationalSystem: '',
//     strengths: '',
//     weaknesses: ''
//   });

//   const [teacherData, setTeacherData] = useState({
//     country: '',
//     educationalSystem: '',
//     languageProficiencies: '',
//     subjectArea: '',
//     contactInfo: ''
//   });

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
//       if (currentUser) {
//         setUser(currentUser);
//         const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//         }
//       } else {
//         setUser(null);
//         setUserRole('');
//         setUserProfile(null);
//       }
//       setInitializing(false);
//     });

//     return () => unsubscribe();
//   }, []);

//   const handleAuth = async () => {
//     if (!email || !password) {
//       setError('Please fill in all fields');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       if (isLogin) {
//         const userCredential = await signInWithEmailAndPassword(auth, email, password);
//         const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
//         if (userDoc.exists()) {
//           const profileData = userDoc.data();
//           setUserRole(profileData.role);
//           setUserProfile(profileData);
//           setUser(userCredential.user);
//         } else {
//           setError('User data not found');
//         }
//       } else {
//         const userCredential = await createUserWithEmailAndPassword(auth, email, password);
//         setUser(userCredential.user);
//         setStep(2);
//       }
//     } catch (err) {
//       if (err.code === 'auth/email-already-in-use') {
//         setError('This email is already registered. Please sign in.');
//       } else if (err.code === 'auth/wrong-password') {
//         setError('Incorrect password. Please try again.');
//       } else if (err.code === 'auth/user-not-found') {
//         setError('No account found with this email.');
//       } else if (err.code === 'auth/weak-password') {
//         setError('Password should be at least 6 characters.');
//       } else if (err.code === 'auth/invalid-email') {
//         setError('Please enter a valid email address.');
//       } else {
//         setError(err.message);
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleProfileSubmit = async () => {
//     setError('');
//     setLoading(true);

//     try {
//       const profileData = role === 'student' ? studentData : teacherData;
//       const hasEmptyFields = Object.values(profileData).some(val => !val.trim());
//       if (hasEmptyFields) {
//         setError('Please fill in all fields');
//         setLoading(false);
//         return;
//       }

//       const completeProfile = {
//         email: email,
//         role: role,
//         ...profileData,
//         createdAt: new Date().toISOString()
//       };

//       await setDoc(doc(db, 'users', user.uid), completeProfile);
      
//       setUserRole(role);
//       setUserProfile(completeProfile);
//       setStep(1);
//     } catch (err) {
//       setError('Failed to save profile: ' + err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     try {
//       await signOut(auth);
//       setUser(null);
//       setUserRole('');
//       setUserProfile(null);
//       setEmail('');
//       setPassword('');
//       setStudentData({ country: '', educationalSystem: '', strengths: '', weaknesses: '' });
//       setTeacherData({ country: '', educationalSystem: '', languageProficiencies: '', subjectArea: '', contactInfo: '' });
//       setStep(1);
//     } catch (err) {
//       setError(err.message);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       if (step === 1) {
//         handleAuth();
//       } else {
//         handleProfileSubmit();
//       }
//     }
//   };

//   if (initializing) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 flex items-center justify-center">
//         <div className="text-white text-center">
//           <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
//           <p className="text-xl font-semibold">Loading...</p>
//         </div>
//       </div>
//     );
//   }

//   if (user && userRole === 'student' && userProfile) {
//     return <StudentDashboard user={user} studentProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (user && userRole === 'teacher' && userProfile) {
//     return <TeacherDashboard user={user} teacherProfile={userProfile} onLogout={handleLogout} />;
//   }

//   if (step === 2 && user) {
//     return (
//       <div className="min-h-screen bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 flex items-center justify-center p-4">
//         <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-12">
//           <div className="mb-8">
//             <h1 className="text-3xl font-bold text-gray-800 mb-2">Complete Your Profile</h1>
//             <p className="text-gray-600">
//               {role === 'student' ? 'Student Information' : 'Teacher Information'}
//             </p>
//           </div>

//           {error && (
//             <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 mb-6">
//               {error}
//             </div>
//           )}

//           {role === 'student' ? (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.country}
//                   onChange={(e) => setStudentData({...studentData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={studentData.educationalSystem}
//                   onChange={(e) => setStudentData({...studentData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Your Strengths
//                 </label>
//                 <textarea
//                   value={studentData.strengths}
//                   onChange={(e) => setStudentData({...studentData, strengths: e.target.value})}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none text-gray-800"
//                   rows="3"
//                   placeholder="Enter your strengths"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Areas for Improvement
//                 </label>
//                 <textarea
//                   value={studentData.weaknesses}
//                   onChange={(e) => setStudentData({...studentData, weaknesses: e.target.value})}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none text-gray-800"
//                   rows="3"
//                   placeholder="Enter areas for improvement"
//                 />
//               </div>
//             </div>
//           ) : (
//             <div className="space-y-5">
//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Country
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.country}
//                   onChange={(e) => setTeacherData({...teacherData, country: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter country"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Educational System
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.educationalSystem}
//                   onChange={(e) => setTeacherData({...teacherData, educationalSystem: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter educational system"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Language Proficiencies
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.languageProficiencies}
//                   onChange={(e) => setTeacherData({...teacherData, languageProficiencies: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter languages"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Subject Area
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.subjectArea}
//                   onChange={(e) => setTeacherData({...teacherData, subjectArea: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter subject"
//                 />
//               </div>

//               <div>
//                 <label className="block text-gray-800 font-semibold mb-2">
//                   Contact Information
//                 </label>
//                 <input
//                   type="text"
//                   value={teacherData.contactInfo}
//                   onChange={(e) => setTeacherData({...teacherData, contactInfo: e.target.value})}
//                   onKeyPress={handleKeyPress}
//                   className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//                   placeholder="Enter contact info"
//                 />
//               </div>
//             </div>
//           )}

//           <button
//             onClick={handleProfileSubmit}
//             disabled={loading}
//             className="w-full mt-8 bg-green-600 hover:bg-green-700 text-white py-4 rounded-lg font-bold text-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Saving...' : 'Submit'}
//           </button>

//           <p className="text-center text-gray-600 mt-6">
//             Forgot <a href="#" className="text-green-600 hover:underline font-semibold">password?</a>
//           </p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 flex items-center justify-center p-4">
//       <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-12">
//         <div className="mb-8">
//           <h1 className="text-4xl font-bold text-gray-800 mb-3">
//             {isLogin ? 'Sign In' : 'Sign Up'}
//           </h1>
//           <p className="text-gray-600 text-base">
//             {isLogin ? 'Welcome back! Please sign in to continue.' : 'Create your account to get started.'}
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 mb-6">
//             {error}
//           </div>
//         )}

//         <div className="space-y-5">
//           <div>
//             <label className="block text-gray-800 font-semibold mb-2">
//               Email address
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//               placeholder="Enter email"
//             />
//           </div>

//           <div>
//             <label className="block text-gray-800 font-semibold mb-2">
//               Password
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               onKeyPress={handleKeyPress}
//               className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800"
//               placeholder="Enter password"
//             />
//             {!isLogin && (
//               <p className="text-xs text-gray-500 mt-2">Must be at least 6 characters</p>
//             )}
//           </div>

//           {!isLogin && (
//             <div>
//               <label className="block text-gray-800 font-semibold mb-2">
//                 I am a
//               </label>
//               <select
//                 value={role}
//                 onChange={(e) => setRole(e.target.value)}
//                 className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer text-gray-800"
//               >
//                 <option value="student">Student</option>
//                 <option value="teacher">Teacher</option>
//               </select>
//             </div>
//           )}

//           {isLogin && (
//             <div className="flex items-center">
//               <input
//                 type="checkbox"
//                 id="remember"
//                 className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
//               />
//               <label htmlFor="remember" className="ml-2 text-gray-700">
//                 Remember me
//               </label>
//             </div>
//           )}

//           <button
//             onClick={handleAuth}
//             disabled={loading}
//             className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-lg font-bold text-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//           >
//             {loading ? 'Processing...' : 'Submit'}
//           </button>
//         </div>

//         <p className="text-center text-gray-600 mt-6">
//           {isLogin ? (
//             <>
//               Don't have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(false);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign Up
//               </button>
//             </>
//           ) : (
//             <>
//               Already have an account?{' '}
//               <button
//                 onClick={() => {
//                   setIsLogin(true);
//                   setError('');
//                 }}
//                 className="text-green-600 hover:underline font-semibold"
//               >
//                 Sign In
//               </button>
//             </>
//           )}
//         </p>

//         {isLogin && (
//           <p className="text-center text-gray-600 mt-4">
//             Forgot <a href="#" className="text-green-600 hover:underline font-semibold">password?</a>
//           </p>
//         )}
//       </div>
//     </div>
//   );
// }












