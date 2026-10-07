import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { Field, Alert, Spinner, Icon } from '../components/ui';

export default function Auth({ mode }) {
  const isSignup = mode === 'signup';
  const { login, signup, config, sessionExpired } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const requested = location.state?.from;
  const from = requested && !requested.startsWith('/login') ? requested : '/';
  const expired = sessionExpired;

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    area: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isSignup) {
        const area = config.areas.find((a) => a.name === form.area);
        await signup({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          area: form.area,
          lat: area?.lat,
          lng: area?.lng,
        });
      } else {
        await login({ email: form.email, password: form.password });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setForm({ ...form, email: 'ayesha@shelf.app', password: 'password123' });
    setError('');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2">
      {/* Form */}
      <div className="flex items-center justify-center px-5 py-14">
        <div className="w-full max-w-sm rise">
          <h1 className="text-[34px] font-extrabold leading-tight">
            {isSignup ? 'Join Shelf' : 'Welcome back'}
          </h1>
          <p className="text-muted mt-2 text-[15px]">
            {isSignup
              ? 'Borrow from your neighbours, lend what you have read.'
              : 'Log in to borrow and manage your shelf.'}
          </p>

          {expired && !isSignup && (
            <div className="mt-5">
              <Alert tone="info">
                You were signed out after a while away. Log in to pick up where you left off.
              </Alert>
            </div>
          )}

          <form onSubmit={submit} className="mt-8 space-y-5">
            {isSignup && (
              <Field label="Full name">
                <input value={form.name} onChange={set('name')} className="input" required autoComplete="name" placeholder="Your name" />
              </Field>
            )}

            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} className="input" required autoComplete="email" placeholder="you@example.com" />
            </Field>

            <Field label="Password" hint={isSignup ? '10 to 256 characters' : undefined}>
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                className="input"
                required
                minLength={10}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder="••••••••"
              />
            </Field>

            {isSignup && (
              <>
                <Field label="Phone" hint="Only shared with people you agree to lend to or borrow from.">
                  <input value={form.phone} onChange={set('phone')} className="input" placeholder="+8801…" autoComplete="tel" />
                </Field>

                <Field label="Your area" hint="Sets where your books are picked up from.">
                  <select value={form.area} onChange={set('area')} className="input" required>
                    <option value="" disabled>Choose an area</option>
                    {config.areas.map((a) => (
                      <option key={a.name} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {error && <Alert>{error}</Alert>}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner className="w-5 h-5" /> : isSignup ? 'Create account' : 'Log in'}
            </button>
          </form>

          {!isSignup && (
            <button onClick={fillDemo} className="btn-secondary w-full mt-3">
              Use a demo account
            </button>
          )}

          <p className="text-center text-[15px] text-muted mt-7">
            {isSignup ? 'Already have an account?' : 'New to Shelf?'}{' '}
            <Link
              to={isSignup ? '/login' : '/signup'}
              state={{ from }}
              className="font-semibold text-ink underline underline-offset-2"
            >
              {isSignup ? 'Log in' : 'Create one'}
            </Link>
          </p>
        </div>
      </div>

      {/* Editorial panel */}
      <div className="hidden lg:flex bg-ink text-paper items-center px-16">
        <div className="max-w-md">
          <h2 className="text-[44px] font-extrabold leading-[1.02]">
            A city full of bookshelves.
          </h2>
          <ul className="mt-10 space-y-6">
            {[
              ['Pay by the day', 'Set or compare daily rates instead of buying a book you will read once.'],
              ['Walkable pickups', 'Every listing shows how far it is from where you are standing.'],
              ['Reviewed lenders', 'Ratings come only from people who actually returned a book.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-4">
                <span className="w-8 h-8 rounded-full bg-paper text-ink grid place-items-center shrink-0 mt-0.5">
                  <Icon name="check" className="w-4 h-4" />
                </span>
                <div>
                  <p className="font-bold text-lg">{title}</p>
                  <p className="text-paper/60 mt-1 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
