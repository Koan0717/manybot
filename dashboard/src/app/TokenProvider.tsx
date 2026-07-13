'use client';
import { useEffect } from 'react';

export default function TokenProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const originalFetch = window.fetch;
      window.fetch = async function (...args) {
        let [resource, config] = args;
        const token = localStorage.getItem('dashboard_session');
        
        if (token) {
          config = config || {};
          config.headers = config.headers || {};
          
          if (config.headers instanceof Headers) {
            if (!config.headers.has('Authorization')) {
              config.headers.set('Authorization', `Bearer ${token}`);
            }
          } else if (Array.isArray(config.headers)) {
            const hasAuth = config.headers.some(([key]) => key.toLowerCase() === 'authorization');
            if (!hasAuth) {
              config.headers.push(['Authorization', `Bearer ${token}`]);
            }
          } else {
            const headersRecord = config.headers as Record<string, string>;
            const hasAuth = Object.keys(headersRecord).some(key => key.toLowerCase() === 'authorization');
            if (!hasAuth) {
              headersRecord['Authorization'] = `Bearer ${token}`;
            }
          }
          args[1] = config;
        }
        return originalFetch.apply(this, args as any);
      };
    }
  }, []);

  return <>{children}</>;
}
