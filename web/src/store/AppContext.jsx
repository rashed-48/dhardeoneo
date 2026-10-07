import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, setUnauthorizedHandler } from '../lib/api';

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
  const [sessionExpired, setSessionExpired] = useState(false);

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

  /**
   * The session lapses after a spell of inactivity. Without this, the app would
   * still look signed in and every action would fail with a bare error, so send
   * the person to the login screen with a note and a way back.
   */
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location);
  here.current = location;

  const expireSession = useCallback(() => {
    setSessionExpired(true);
    setUser(null);

    const { pathname, search } = here.current;
    // Already on the login screen: keep whichever destination was saved first,
    // or a later stray 401 would make the login screen redirect to itself.
    if (pathname === '/login') return;

    navigate('/login', { replace: true, state: { from: pathname + search } });
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(expireSession);
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);

  /**
   * Opening a signed-in page is not enough to notice a lapsed session, because
   * some of them fetch nothing on arrival. Protected routes call this so the
   * check happens on entry rather than at the moment someone presses save.
   */
  const verifySession = useCallback(async () => {
    try {
      const { user: fresh } = await api.me();
      setUser(fresh);
      return true;
    } catch (error) {
      if (error.status === 401) expireSession();
      return false;
    }
  }, [expireSession]);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        if (user.lat != null && user.lng != null && !localStorage.getItem(PLACE_KEY)) {
          setPlace({ name: user.area || 'My area', lat: user.lat, lng: user.lng });
        }
      })
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [setPlace]);

  const authenticate = useCallback(
    async (fn) => {
      const { user } = await fn();
      setSessionExpired(false);
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
      verifySession,
      sessionExpired,
      dismissExpiredNotice: () => setSessionExpired(false),
      login: (payload) => authenticate(() => api.login(payload)),
      signup: (payload) => authenticate(() => api.signup(payload)),
      logout: () => {
        api.logout().catch(() => {});
        setSessionExpired(false);
        setUser(null);
      },
      refreshUser: async () => {
        const { user } = await api.me();
        setUser(user);
        return user;
      },
    }),
    [user, booting, config, place, setPlace, authenticate, verifySession, sessionExpired]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
