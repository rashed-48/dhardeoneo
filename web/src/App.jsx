import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import Header from './components/Header';
import Home from './pages/Home';
import Browse from './pages/Browse';
import BookDetail from './pages/BookDetail';
import Auth from './pages/Auth';
import ListBook from './pages/ListBook';
import Dashboard from './pages/Dashboard';
import { Empty, Loading } from './components/ui';

/**
 * Signed-in pages re-check the session when they are opened. The page renders
 * straight away on an optimistic session, so there is no flash of loading; if
 * the check comes back unauthorised, AppContext redirects to the login screen.
 */
function Protected({ children }) {
  const { user, booting, verifySession } = useApp();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!booting && user) verifySession();
  }, [pathname, booting, user, verifySession]);

  if (booting) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  return children;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Footer() {
  return (
    <footer className="border-t border-line mt-20">
      <div className="max-w-7xl mx-auto px-5 py-12 flex flex-col sm:flex-row gap-8 justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-ink rounded-[5px] grid place-items-center">
              <span className="w-2.5 h-2.5 border-2 border-paper border-t-0 rounded-b-[2px]" />
            </span>
            <span className="text-[17px] font-extrabold tracking-[-0.04em]">Shelf</span>
          </div>
          <p className="text-[14px] text-muted mt-3 max-w-xs leading-relaxed">
            Books are worth more moving between hands than sitting on a shelf.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-10 gap-y-3 text-[14px]">
          <Link to="/browse" className="text-muted hover:text-ink">Browse</Link>
          <Link to="/lend" className="text-muted hover:text-ink">Lend a book</Link>
          <Link to="/dashboard" className="text-muted hover:text-ink">My rentals</Link>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="max-w-7xl mx-auto px-5 py-5 text-[13px] text-muted">
          A demo marketplace. Card payments run through a simulated gateway — no real money moves.
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <ScrollToTop />
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/book/:id" element={<BookDetail />} />
              <Route path="/login" element={<Auth mode="login" />} />
              <Route path="/signup" element={<Auth mode="signup" />} />
              <Route path="/lend" element={<Protected><ListBook /></Protected>} />
              <Route path="/lend/:id" element={<Protected><ListBook /></Protected>} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route
                path="*"
                element={
                  <Empty
                    title="Page not found"
                    body="That link does not lead anywhere on Shelf."
                    action={<Link to="/" className="btn-primary">Go home</Link>}
                  />
                }
              />
            </Routes>
          </main>
          <Footer />
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}
