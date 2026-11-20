import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { UserRole, UserSession } from '../types';

interface AuthContextType {
  user: UserSession | null;
  loading: boolean;
  login: (roleKey: 'superadmin' | 'manager' | 'employee') => Promise<void>;
  loginWithCredentials: (email: string, pass: string) => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getCurrentUser()
      .then((u) => setUser(u))
      .finally(() => setLoading(false));

    const handleSessionExpired = (e: Event) => {
      const customEvent = e as CustomEvent<{ message?: string }>;
      console.warn('[AuthContext] Session expired notification received:', customEvent.detail?.message);
      setUser(null);
    };

    window.addEventListener('nexus:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('nexus:session-expired', handleSessionExpired);
    };
  }, []);

  const login = async (roleKey: 'superadmin' | 'manager' | 'employee') => {
    setLoading(true);
    try {
      const u = await api.login(roleKey);
      setUser(u);
    } finally {
      setLoading(false);
    }
  };

  const loginWithCredentials = async (email: string, pass: string) => {
    setLoading(true);
    try {
      if (api.loginWithCredentials) {
        const u = await api.loginWithCredentials(email, pass);
        setUser(u);
      } else {
        const u = await api.login(email.includes('admin') ? 'superadmin' : email.includes('manager') ? 'manager' : 'employee');
        setUser(u);
      }
    } finally {
      setLoading(false);
    }
  };

  const switchRole = async (role: UserRole) => {
    setLoading(true);
    try {
      const u = await api.switchRole(role);
      setUser(u);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await api.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithCredentials, switchRole, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
