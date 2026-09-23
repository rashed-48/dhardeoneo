import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../lib/api';

const AppContext = createContext(null);
const PLACE_KEY = 'shelf.place';

const DEFAULT_PLACE = { name: 'Dhanmondi', lat: 23.7461, lng: 90.3742 };

const readPlace = () => {
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_PLACE;
  } catch {
    return DEFAULT_PLACE;
  }
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [config, setConfig] = useState({ areas: [], categories: [], currency: '৳' });

  // "Where am I searching from" — drives every distance shown in the app.
  const [place, setPlaceState] = useState(readPlace);

  const setPlace = useCallback((next) => {
    setPlaceState(next);
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        if (user.lat != null && user.lng != null && !localStorage.getItem(PLACE_KEY)) {
          setPlace({ name: user.area || 'My area', lat: user.lat, lng: user.lng });
        }
      })
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, [setPlace]);

  const authenticate = useCallback(
    async (fn) => {
      const { token, user } = await fn();
      setToken(token);
      setUser(user);
      if (user.lat != null && user.lng != null) {
        setPlace({ name: user.area || 'My area', lat: user.lat, lng: user.lng });
      }
      return user;
    },
    [setPlace]
  );

  const value = useMemo(
    () => ({
      user,
      booting,
      config,
      place,
      setPlace,
      login: (payload) => authenticate(() => api.login(payload)),
      signup: (payload) => authenticate(() => api.signup(payload)),
      logout: () => {
        setToken(null);
        setUser(null);
      },
      refreshUser: async () => {
        const { user } = await api.me();
        setUser(user);
        return user;
      },
    }),
    [user, booting, config, place, setPlace, authenticate]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
