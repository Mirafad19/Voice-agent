import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  login: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set a timeout to force loading to false if onAuthStateChanged hangs
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn("Auth state check timed out.");
        setLoading(false);
      }
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      clearTimeout(timeoutId);
      if (currentUser) {
        const email = (currentUser.email || '').toLowerCase();
        const isAllowedDomain = email.endsWith('@pssdc.ng');
        const isAllowedDeveloper = email === 'fadahunsi.miracle@gmail.com';
        const isAllowedOfficialGmail = email === 'lspssdc.ng@gmail.com';

        if (isAllowedDomain || isAllowedDeveloper || isAllowedOfficialGmail) {
          setUser(currentUser);
          setError(null);
        } else {
          try {
            await signOut(auth);
          } catch (err) {
            console.error('Error signing out unauthorized user:', err);
          }
          setUser(null);
          setError('Access Denied: Only PSSDC accounts (@pssdc.ng) and authorized developers can access this dashboard.');
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [loading]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    setError(null);
    try {
      const result = await signInWithPopup(auth, provider);
      const email = (result.user?.email || '').toLowerCase();
      const isAllowedDomain = email.endsWith('@pssdc.ng');
      const isAllowedDeveloper = email === 'fadahunsi.miracle@gmail.com';
      const isAllowedOfficialGmail = email === 'lspssdc.ng@gmail.com';

      if (!isAllowedDomain && !isAllowedDeveloper && !isAllowedOfficialGmail) {
        await signOut(auth);
        setUser(null);
        setError('Access Denied: Only PSSDC accounts (@pssdc.ng) and authorized developers can access this dashboard.');
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Login failed. Please try again.');
      
      if (err.code === 'auth/unauthorized-domain') {
        setError('Unauthorized Domain: Please add your live URL to the "Authorized domains" list in the Firebase Console (Authentication > Settings).');
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
