import { useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { Icon, Sheet } from './ui';
import LocationSheet from './LocationSheet';

const Wordmark = () => (
  <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Shelf home">
    <span className="w-7 h-7 bg-ink rounded-[6px] grid place-items-center">
      <span className="w-3 h-3 border-2 border-paper border-t-0 rounded-b-[2px]" />
    </span>
    <span className="text-[19px] font-extrabold tracking-[-0.04em]">Shelf</span>
  </Link>
);

export default function Header() {
  const { user, place, logout } = useApp();
  const [locationOpen, setLocationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const signOut = () => {
    logout();
    setMenuOpen(false);
    navigate('/');
  };

  const navLink = ({ isActive }) =>
    `text-[15px] font-medium transition-colors ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`;

  return (
    <>
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-line">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center gap-4">
          <Wordmark />

          <button
            onClick={() => setLocationOpen(true)}
            className="hidden sm:inline-flex items-center gap-2 h-10 px-3.5 rounded-full bg-mist hover:bg-line transition-colors max-w-[220px]"
          >
            <Icon name="pin" className="w-4 h-4 shrink-0" />
            <span className="text-[14px] font-medium truncate">{place.name}</span>
          </button>

          <nav className="hidden md:flex items-center gap-6 ml-2">
            <NavLink to="/browse" className={navLink}>Browse</NavLink>
            {user && <NavLink to="/dashboard" className={navLink}>My rentals</NavLink>}
          </nav>

          <div className="flex-1" />

          <Link to="/lend" className="hidden sm:inline-flex btn-ghost btn-sm">
            <Icon name="plus" className="w-4 h-4" />
            Lend a book
          </Link>

          {user ? (
            <button
              onClick={() => setMenuOpen(true)}
              className="w-10 h-10 rounded-full bg-ink text-paper grid place-items-center text-[14px] font-bold shrink-0"
              aria-label="Account menu"
            >
              {user.name.charAt(0).toUpperCase()}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                state={{ from: pathname }}
                className="hidden sm:inline-flex btn-ghost btn-sm"
              >
                Log in
              </Link>
              <Link to="/signup" className="btn-primary btn-sm">Sign up</Link>
            </div>
          )}

          <button
            onClick={() => setMenuOpen(true)}
            className="md:hidden w-10 h-10 grid place-items-center rounded-full hover:bg-mist shrink-0"
            aria-label="Menu"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </header>

      <LocationSheet open={locationOpen} onClose={() => setLocationOpen(false)} />

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={user ? user.name : 'Menu'} maxWidth="max-w-sm">
        <div className="flex flex-col gap-1 -mx-2">
          {user && (
            <div className="px-2 pb-4 mb-2 border-b border-line">
              <p className="text-sm text-muted">{user.email}</p>
              {user.area && <p className="text-sm text-muted mt-0.5">{user.area}</p>}
            </div>
          )}

          <MenuItem to="/browse" onClick={() => setMenuOpen(false)} icon="search" label="Browse books" />
          <MenuItem to="/lend" onClick={() => setMenuOpen(false)} icon="plus" label="Lend a book" />
          {user && <MenuItem to="/dashboard" onClick={() => setMenuOpen(false)} icon="book" label="My rentals" />}
          <button
            onClick={() => {
              setMenuOpen(false);
              setLocationOpen(true);
            }}
            className="flex items-center gap-3 px-2 h-12 rounded-lg hover:bg-mist text-left"
          >
            <Icon name="pin" className="w-5 h-5" />
            <span className="text-[15px] font-medium">Change location</span>
            <span className="ml-auto text-[13px] text-muted truncate max-w-[110px]">{place.name}</span>
          </button>

          <div className="border-t border-line mt-3 pt-3">
            {user ? (
              <button onClick={signOut} className="w-full btn-secondary">Log out</button>
            ) : (
              <div className="flex flex-col gap-2">
                <Link to="/login" onClick={() => setMenuOpen(false)} className="btn-primary w-full">Log in</Link>
                <Link to="/signup" onClick={() => setMenuOpen(false)} className="btn-secondary w-full">Create account</Link>
              </div>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}

function MenuItem({ to, onClick, icon, label }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-3 px-2 h-12 rounded-lg hover:bg-mist">
      <Icon name={icon} className="w-5 h-5" />
      <span className="text-[15px] font-medium">{label}</span>
    </Link>
  );
}
